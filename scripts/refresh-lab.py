#!/usr/bin/env python3
"""Persistent, isolated refresh lab using existing Node, PostgreSQL 18 and Poppler."""
import argparse, fcntl, json, os, pathlib, re, secrets, shutil, signal, socket, subprocess, sys, time, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
STATE=ROOT/'.vani-refresh-lab'
SCRIPT=pathlib.Path(__file__).resolve()

def pid():
 try:
  value=int((STATE/'supervisor.pid').read_text())
  if value<2:return None
  cmd=subprocess.check_output(['ps','-p',str(value),'-o','command='],text=True).strip()
  return value if str(SCRIPT)+' serve' in cmd else None
 except (OSError,ValueError,subprocess.SubprocessError):return None

def health():
 try:
  with urllib.request.urlopen('http://127.0.0.1:18082/lab/api/meta',timeout=2) as r:return json.load(r).get('root')==str(STATE)
 except Exception:return False

def serve():
 if not (STATE/'.lab-owned').is_file():raise RuntimeError('Lab ownership marker is missing.')
 os.umask(0o077)
 pgctl=shutil.which('pg_ctl');node=shutil.which('node')
 missing=[n for n in ('pg_ctl','node','pdftotext') if not shutil.which(n)]
 if missing:raise RuntimeError('Missing host tools: '+', '.join(missing))
 pg=pathlib.Path(pgctl).resolve().parent
 version=subprocess.check_output([str(pg/'postgres'),'--version'],text=True)
 if not re.search(r'PostgreSQL\) 18\.',version):raise RuntimeError('The lab requires PostgreSQL 18 with pgvector.')
 if not (ROOT/'apps/api/dist/app.js').exists():raise RuntimeError('Run npm run build first.')
 STATE.mkdir(exist_ok=True,mode=0o700)
 for name in ('logs','data','reports','tmp'): (STATE/name).mkdir(exist_ok=True,mode=0o700)
 with (STATE/'supervisor.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  settings=json.loads((STATE/'models.json').read_text()) if (STATE/'models.json').exists() else {}
  ports=[55442,18082]+([11436] if settings.get('OLLAMA_BASE_URL')=='http://127.0.0.1:11436' else [])
  for port in ports:
   with socket.socket() as s:
    s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    s.bind(('127.0.0.1',port))
  password=STATE/'database-password'
  if not password.exists():password.write_text(secrets.token_urlsafe(32))
  password.chmod(0o600)
  secret=password.read_text().strip()
  env={k:v for k,v in os.environ.items() if not k.startswith('PG') and k not in ('OPENAI_API_KEY','DATABASE_URL','VANI_DATA_DIR')}
  env.update({'PGHOST':'127.0.0.1','PGPORT':'55442','PGUSER':'vani_lab','PGPASSWORD':secret,'PGDATABASE':'postgres','PGCONNECT_TIMEOUT':'5','TMPDIR':str(STATE/'tmp'),'VANI_LAB_DIR':str(STATE),'VANI_REFRESH_LAB':'true','DATABASE_URL':f'postgres://vani_lab:{secret}@127.0.0.1:55442/vani_refresh_lab','VANI_DATA_DIR':str(STATE/'data'),'VANI_DEMO_MODE':'false','VANI_CLOUD_MODE':'off','NODE_ENV':'test','VANI_API_HOST':'127.0.0.1','VANI_API_PORT':'18082','VANI_WEB_ORIGIN':'http://127.0.0.1:18082'})
  env.update(settings)
  cluster=STATE/'postgres'
  if not cluster.exists():
   subprocess.run([str(pg/'initdb'),'-D',str(cluster),'-U','vani_lab','--pwfile',str(password),'--auth=scram-sha-256','--encoding=UTF8','--locale=C'],check=True,env=env)
  elif not (cluster/'PG_VERSION').exists() or (cluster/'PG_VERSION').read_text().strip()!='18':raise RuntimeError('Lab cluster is incomplete or incompatible; preserve it and inspect before proceeding.')
  stopping=False;child=None;model_child=None;started=False
  def stop(*_):
   nonlocal stopping
   stopping=True
  signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
  (STATE/'supervisor.pid').write_text(str(os.getpid()))
  try:
   subprocess.run([str(pg/'pg_ctl'),'-D',str(cluster),'-l',str(STATE/'logs/postgres.log'),'-o',"-h 127.0.0.1 -p 55442 -k ''",'-w','start'],check=True,env=env);started=True
   exists=subprocess.check_output([str(pg/'psql'),'-X','-Atc',"SELECT 1 FROM pg_database WHERE datname='vani_refresh_lab'"],text=True,env=env).strip()
   if exists!='1':subprocess.run([str(pg/'createdb'),'vani_refresh_lab'],check=True,env=env)
   if settings.get('OLLAMA_BASE_URL')=='http://127.0.0.1:11436':
    model_env=env.copy();model_env.update({'OLLAMA_HOST':'127.0.0.1:11436','OLLAMA_MODELS':str(STATE/'models'),'OLLAMA_NO_CLOUD':'1','OLLAMA_NUM_PARALLEL':'1','OLLAMA_MAX_LOADED_MODELS':'1'})
    with (STATE/'logs/ollama.log').open('ab') as model_log:
     model_child=subprocess.Popen([str(STATE/'runtime/ollama/ollama'),'serve'],env=model_env,stdout=model_log,stderr=subprocess.STDOUT)
    for _ in range(60):
     if model_child.poll() is not None:raise RuntimeError('Local model server exited; inspect the lab Ollama log.')
     try:
      with urllib.request.urlopen('http://127.0.0.1:11436/api/tags',timeout=2):break
     except Exception:time.sleep(.5)
    else:raise RuntimeError('Local model server startup timed out.')
   with (STATE/'logs/api.log').open('ab') as log:
    child=subprocess.Popen([node,str(ROOT/'scripts/refresh-lab/server.mjs')],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
    while not stopping:
     if model_child and model_child.poll() is not None:raise RuntimeError('Local model server stopped; inspect the lab Ollama log.')
     if child.poll() is not None:raise RuntimeError('Lab API exited; inspect '+str(STATE/'logs/api.log'))
     time.sleep(.5)
  finally:
   if child and child.poll() is None:
    child.terminate()
    try:child.wait(timeout=20)
    except subprocess.TimeoutExpired:child.kill();child.wait()
   if model_child and model_child.poll() is None:
    model_child.terminate()
    try:model_child.wait(timeout=15)
    except subprocess.TimeoutExpired:model_child.kill();model_child.wait()
   if started or (cluster/'postmaster.pid').exists():subprocess.run([str(pg/'pg_ctl'),'-D',str(cluster),'-m','fast','-w','stop'],check=True,env=env)
   (STATE/'supervisor.pid').unlink(missing_ok=True)

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['start','stop','status','serve']);parser.add_argument('--reader');parser.add_argument('--embedding');parser.add_argument('--ollama-url')
 args=parser.parse_args()
 if args.action=='status':print('Running at http://127.0.0.1:18082/lab' if pid() and health() else 'Stopped or not ready; logs: '+str(STATE/'logs'));return
 if args.action=='stop':
  value=pid()
  if value:
   os.kill(value,signal.SIGTERM)
   for _ in range(80):
    if pid()!=value:break
    time.sleep(.5)
   else:raise RuntimeError('Lab shutdown timed out; inspect logs.')
  print('Lab stopped; data and review snapshots preserved.');return
 if args.action=='serve':serve();return
 if pid():print('Lab already running. Stop it before changing model settings.');return
 if STATE.exists() and not (STATE/'.lab-owned').exists():raise RuntimeError('Refusing to use an unmarked lab directory.')
 os.umask(0o077);STATE.mkdir(exist_ok=True,mode=0o700);(STATE/'.lab-owned').write_text('vani-refresh-lab-v1')
 settings=json.loads((STATE/'models.json').read_text()) if (STATE/'models.json').exists() else {}
 for key,value in [('OLLAMA_MODEL',args.reader),('OLLAMA_EMBED_MODEL',args.embedding),('OLLAMA_BASE_URL',args.ollama_url)]:
  if value:settings[key]=value
 if args.embedding:settings['VANI_EMBED_MODEL']=args.embedding
 if args.ollama_url:
  from urllib.parse import urlparse
  if urlparse(args.ollama_url).hostname not in ('localhost','127.0.0.1','::1'):raise RuntimeError('Models must use a loopback endpoint.')
 (STATE/'models.json').write_text(json.dumps(settings,indent=2))
 with (STATE/'supervisor.log').open('ab') as log:child=subprocess.Popen([sys.executable,str(SCRIPT),'serve'],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 for _ in range(120):
  if child.poll() is not None:raise RuntimeError('Lab startup failed; inspect '+str(STATE/'supervisor.log'))
  if health():print('Refresh lab: http://127.0.0.1:18082/lab\nPrivate data: '+str(STATE));return
  time.sleep(.5)
 child.terminate();raise RuntimeError('Startup timed out; inspect lab logs.')

if __name__=='__main__':
 try:main()
 except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
