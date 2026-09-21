#!/usr/bin/env python3
"""Named, isolated VANI diagnostic jobs; invoked over SSH, never through HTTP."""
import argparse, contextlib, datetime, fcntl, hashlib, json, os, pathlib, re, secrets, select, shutil, signal, socket, subprocess, sys, time, urllib.request, uuid

JOBS=('doctor','snapshot','regression','model-smoke','browser','lab','soak','replay')
GPU_JOBS=('model-smoke','browser','lab','soak','replay')
ID=re.compile(r'^[0-9a-f]{32}$')
_detached_children=[]
class Cancelled(Exception): pass

def read(path, default=None):
    try: return json.loads(path.read_text())
    except (OSError, ValueError): return default

def write(path, value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    temp=path.with_name(path.name+'.tmp-'+str(os.getpid()))
    temp.write_text(json.dumps(value,indent=2));temp.chmod(0o600);temp.replace(path)

def roots(root, install):
    root=pathlib.Path(root).absolute();install=pathlib.Path(install).absolute()
    if root.resolve()!=root or install.resolve()!=install: raise ValueError('Use canonical paths without symlinks.')
    if root==install or root in install.parents or install in root.parents: raise ValueError('Debug and production roots must not overlap.')
    if root==pathlib.Path.home() or root==pathlib.Path('/'): raise ValueError('Use a dedicated debug directory.')
    if not (root/'.vani-debug-owned').is_file(): raise ValueError('Debug ownership marker missing; deploy first.')
    for name in ('runs','runtime','tmp','releases'):
        if (root/name).is_symlink(): raise ValueError('Debug paths must not be symlinks.')
        (root/name).mkdir(exist_ok=True,mode=0o700)
    return root,install

def acquire(root):
    file=(root/'job.lock').open('a')
    try: fcntl.flock(file,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: file.close();raise RuntimeError('A debug job is already active.')
    return file

def load_job(root, job_id):
    if not ID.fullmatch(job_id): raise ValueError('Invalid job ID.')
    job=read(root/'runs'/job_id/'manifest.json')
    if not job: raise ValueError('Job not found.')
    return job

def process_matches(pid, script, job_id):
    if not isinstance(pid,int) or pid<=1: return False
    try:
        data=subprocess.check_output(['ps','-p',str(pid),'-o','uid=','-o','command='],text=True).strip().split(None,1)
        return int(data[0])==os.getuid() and str(script) in data[1] and job_id in data[1] and 'worker' in data[1]
    except (OSError,ValueError,subprocess.SubprocessError,IndexError): return False

def status(root, job_id):
    job=load_job(root,job_id)
    if job['state'] in ('queued','running') and not process_matches(job.get('pid'),job['runner'],job_id):
        # A queued job is written just before spawn; allow a short startup grace.
        if time.time()-job['createdAt']>10: job={**job,'state':'interrupted','message':'Worker missing. Run recover before another job.'}
    return job

def settings(install):
    result={}
    for line in (install/'config/vani.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.split('=',1);result[k.strip()]=v.strip().strip('\"\'')
    return result

def environment(root, install):
    keep=('HOME','USER','LOGNAME','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR','HTTPS_PROXY','HTTP_PROXY','NO_PROXY')
    env={k:os.environ[k] for k in keep if k in os.environ}
    env.update(PATH=os.pathsep.join([str(install/'runtime/node/bin'),str(install/'runtime/deps/bin'),os.environ.get('PATH','/usr/bin:/bin')]),
        TMPDIR=str(root/'tmp'),PYTHONDONTWRITEBYTECODE='1',NODE_ENV='test',VANI_CLOUD_MODE='off',VANI_DEMO_MODE='false',
        npm_config_cache=str(root/'runtime/npm-cache'),PLAYWRIGHT_BROWSERS_PATH=str(root/'runtime/browsers'),OLLAMA_NO_CLOUD='1')
    return env

def private_command(argv, env, cwd, log, timeout=3600, hidden=(), process_record=None):
    """A process group per step; cancel/timeout always tears down the whole step."""
    child=subprocess.Popen([str(x) for x in argv],cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    if process_record: write(process_record,{'pid':child.pid,'argv':[str(x) for x in argv]})
    deadline=time.monotonic()+timeout;pending=b''
    def emit(raw):
        text=raw.decode('utf8',errors='replace')
        for secret in hidden:
            if secret: text=text.replace(secret,'[REDACTED]')
        log.write(text);log.flush()
    try:
        while True:
            if time.monotonic()>deadline: raise TimeoutError('Step exceeded its time limit.')
            if select.select([child.stdout],[],[],.2)[0]:
                block=os.read(child.stdout.fileno(),65536)
                if not block: break
                pending+=block
                if b'\n' in pending:
                    lines,pending=pending.rsplit(b'\n',1);emit(lines+b'\n')
                if len(pending)>1024*1024: raise RuntimeError('Unbounded log line from child process.')
            elif child.poll() is not None: break
        emit(pending)
        code=child.wait(timeout=10)
        if code: raise RuntimeError(f'Step failed with exit code {code}; inspect job.log.')
    finally:
        # Kill leftover grandchildren too, even when the leader already exited.
        try: os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError: pass
        try: child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try: os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            child.wait()
        try: os.killpg(child.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        child.stdout.close()
        if process_record:process_record.unlink(missing_ok=True)

def port_free(port):
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        probe.bind(('127.0.0.1',port))

def get_json(url):
    with urllib.request.urlopen(url,timeout=15) as response:return json.load(response)

class Job:
    def __init__(self,root,install,job_id):
        self.root=root;self.install=install;self.id=job_id;self.folder=root/'runs'/job_id
        self.meta=load_job(root,job_id);self.source=pathlib.Path(self.meta['source']);self.env=environment(root,install)
        self.log=(self.folder/'job.log').open('a',buffering=1);self.hidden=[]
    def save(self,**values):
        self.meta.update(values,updatedAt=time.time());write(self.folder/'manifest.json',self.meta)
    def step(self,name,argv,timeout=3600,env=None):
        self.save(step=name);self.log.write('\n'+name+'\n')
        private_command(argv,env or self.env,self.source,self.log,timeout,self.hidden,self.folder/'step-process.json')
        self.meta.setdefault('completedSteps',[]).append(name);self.save()
    def require_tools(self):
        if not (self.install/'app/.vani-owned').is_file(): raise RuntimeError('Managed production installation missing.')
        missing=[name for name in ('node','npm','pg_ctl','initdb','createdb','psql','pdftotext') if not shutil.which(name,path=self.env['PATH'])]
        if missing: raise RuntimeError('Missing runtime tools: '+', '.join(missing))
    def build(self):
        self.step('Install debug packages',['npm','ci','--include=dev'],1800)
        self.step('Build debug revision',['npm','run','build'],1800)
    @contextlib.contextmanager
    def database(self):
        port_free(55442);cluster=self.folder/'postgres';password=secrets.token_urlsafe(32);self.hidden.append(password)
        pw=self.folder/'pg-password';pw.write_text(password);pw.chmod(0o600)
        env={**self.env,'PGHOST':'127.0.0.1','PGPORT':'55442','PGUSER':'vani_debug','PGPASSWORD':password,'PGDATABASE':'postgres','PGCONNECT_TIMEOUT':'5'}
        self.step('Initialize isolated PostgreSQL',['initdb','-D',cluster,'-U','vani_debug','--pwfile',pw,'--auth=scram-sha-256','--encoding=UTF8','--locale=C'],env=env)
        pw.unlink();(cluster/'.vani-debug-owned').touch()
        try:
            self.step('Start isolated PostgreSQL',['pg_ctl','-D',cluster,'-l',self.folder/'postgres.log','-o',"-h 127.0.0.1 -p 55442 -k ''",'-w','start'],env=env)
            self.step('Create isolated test database',['createdb','vani_debug_test'],env=env)
            test_env={**env,'DATABASE_URL':f'postgres://vani_debug:{password}@127.0.0.1:55442/vani_debug_test','VANI_DATA_DIR':str(self.folder/'objects'),'VANI_INTEGRATION_TEST':'true'}
            yield test_env
        finally:
            if (cluster/'postmaster.pid').exists():self.step('Stop isolated PostgreSQL',['pg_ctl','-D',cluster,'-m','fast','-w','stop'],env=env)
    def restore_production(self):
        # Older installed launchers can mistake TIME_WAIT for a live listener.
        for attempt in range(3):
            try:
                self.step('Restore production after GPU maintenance',[self.install/'bin/vani','start'],240,environment(self.root,self.install))
                return
            except RuntimeError:
                log=self.install/'logs/supervisor.log'
                if attempt==2 or not log.exists() or 'Address already in use' not in log.read_text()[-2048:]:raise
                self.log.write('Production port conflict; retrying startup in 35 seconds.\n')
                time.sleep(35)
    @contextlib.contextmanager
    def maintenance(self):
        if not self.meta['maintenance']: raise RuntimeError('GPU jobs require --maintenance to avoid competing with production.')
        journal=self.root/'maintenance.json'
        control=self.install/'bin/vani'
        state=subprocess.run([str(control),'status'],env=self.env,capture_output=True,text=True)
        if state.returncode not in (0,1): raise RuntimeError('Could not establish production status.')
        if state.returncode==1 and 'stopped' not in state.stdout.lower(): raise RuntimeError('Production is starting or its status is unknown.')
        restore=state.returncode==0
        write(journal,{'jobId':self.id,'install':str(self.install),'restoreProduction':restore,'active':True})
        try:
            if restore:self.step('Stop production for GPU maintenance',[control,'stop'],180)
            yield
        finally:
            if restore:self.restore_production()
            write(journal,{'jobId':self.id,'active':False,'restoreProduction':False})
    @contextlib.contextmanager
    def model(self):
        port_free(11437);config=settings(self.install)
        for key in ('OPENALEX_API_KEY','OPENALEX_EMAIL','SEMANTIC_SCHOLAR_API_KEY'):
            if config.get(key):
                self.env[key]=config[key]
                if key.endswith('KEY'):self.hidden.append(config[key])
        model=config.get('OLLAMA_MODEL');embedding=config.get('OLLAMA_EMBED_MODEL')
        if not model or not embedding: raise RuntimeError('Production local model names are missing.')
        self.env.update(OLLAMA_HOST='127.0.0.1:11437',OLLAMA_BASE_URL='http://127.0.0.1:11437',OLLAMA_MODELS=str(self.install/'models'),OLLAMA_MODEL=model,OLLAMA_EMBED_MODEL=embedding,VANI_EMBED_MODEL=embedding,OLLAMA_NUM_PARALLEL='1',OLLAMA_MAX_LOADED_MODELS='1')
        binary=self.install/'runtime/ollama/bin/ollama'
        with (self.folder/'ollama.log').open('w') as log:
            child=subprocess.Popen([str(binary),'serve'],env=self.env,stdout=log,stderr=log,start_new_session=True)
            write(self.root/'model-process.json',{'pid':child.pid,'binary':str(binary),'jobId':self.id})
            try:
                for _ in range(60):
                    if child.poll() is not None:raise RuntimeError('Debug Ollama stopped; inspect ollama.log.')
                    try:
                        info=get_json('http://127.0.0.1:11437/api/tags');break
                    except Exception:time.sleep(.5)
                else:raise RuntimeError('Debug Ollama startup timeout.')
                write(self.folder/'models.json',info);yield
            finally:
                child.terminate()
                try:child.wait(timeout=15)
                except subprocess.TimeoutExpired:child.kill();child.wait()
                (self.root/'model-process.json').unlink(missing_ok=True)
    def lab(self,soak=False,browser=False):
        script=self.source/'scripts/refresh-lab.py'
        try:
            self.step('Start isolated refresh lab',[sys.executable,script,'start','--reader',self.env['OLLAMA_MODEL'],'--embedding',self.env['OLLAMA_EMBED_MODEL'],'--ollama-url',self.env['OLLAMA_BASE_URL']],180)
            self.save(step='Sandbox running at http://127.0.0.1:3001/lab through SSH tunnel')
            if browser:
                self.step('Sandbox browser smoke',['node','scripts/debug/browser.mjs',self.folder],600)
                return
            deadline=time.monotonic()+self.meta['duration']
            while time.monotonic()<deadline:
                sample={'at':time.time(),'health':get_json('http://127.0.0.1:18082/api/v1/system/health')}
                with (self.folder/'health.jsonl').open('a') as output:output.write(json.dumps(sample)+'\n')
                if soak and any(sample['health'].get(k,{}).get('state')!='ready' for k in ('database','pdf','reader','embedding')):raise RuntimeError('Sandbox health failed during soak.')
                time.sleep(min(30,max(0,deadline-time.monotonic())))
        finally:self.step('Stop isolated refresh lab',[sys.executable,script,'stop'],90)
    def run(self):
        self.require_tools()
        self.step('Runtime identity',['node','--version'],30)
        self.step('PostgreSQL identity',['postgres','--version'],30)
        kind=self.meta['job']
        if kind=='doctor':
            self.step('GPU status',['nvidia-smi','--query-gpu=name,memory.total,memory.used,utilization.gpu','--format=csv,noheader'],30)
            write(self.folder/'host-health.json',{'diskFreeBytes':shutil.disk_usage(self.root).free,'python':sys.version,'commit':self.meta.get('commit')})
            return
        if kind=='snapshot':
            self.step('Read-only production snapshot',['node','scripts/diagnostics/remote.mjs','http://127.0.0.1:3000',self.folder/'snapshot'],900);return
        self.build()
        if kind=='regression':
            with self.database() as env:
                self.step('Full workspace checks including database integrations',['npm','run','check'],3600,env)
                self.step('Lint',['npm','run','lint'],600,env)
                self.step('Installer lifecycle tests',[sys.executable,'-m','unittest','discover','-s','scripts/setup','-p','test_*.py'],600,env)
                self.step('Debug infrastructure tests',[sys.executable,'-m','unittest','discover','-s','scripts/debug','-p','test_*.py'],600,env)
                self.step('Report and proxy tests',['node','--test','scripts/refresh-lab/report.test.mjs','scripts/diagnostics/remote.test.mjs','scripts/web-network.test.mjs'],600,env)
            return
        if kind=='browser':
            self.step('Install sandbox Chromium',['node','node_modules/playwright/cli.js','install','chromium','--only-shell'],600)
            self.step('Verify browser dependencies before maintenance',['node','--input-type=module','-e',"import {chromium} from 'playwright';const b=await chromium.launch({headless:true});await b.close();"],60)
        if kind=='replay':
            replay_input=self.root/'replay-input.json'
            if not replay_input.is_file() or replay_input.is_symlink() or replay_input.stat().st_size>5*1024**2:raise RuntimeError('Stage a private replay-input.json (max 5 MiB) in the debug root first.')
            shutil.copyfile(replay_input,self.folder/'replay-input.json')
        with self.maintenance(),self.model():
            self.step('Actual local-model smoke test',['node','scripts/local-model-smoke.mjs'],900)
            if kind=='replay':
                for profile in ('original','concise'):
                    self.step('Replay '+profile,['node','scripts/debug/replay.mjs','run',self.folder/'replay-input.json',self.folder/('replay-'+profile+'.json'),'--profile='+profile,'--limit=5'],3600)
            if kind in ('lab','soak','browser'):self.lab(kind=='soak',kind=='browser')

def worker(root,install,job_id,lock_fd):
    if lock_fd is None:raise ValueError('Worker requires an inherited lock.')
    os.fstat(lock_fd);job=Job(root,install,job_id)
    def cancel(*_):raise Cancelled('Cancelled by operator.')
    signal.signal(signal.SIGTERM,cancel);signal.signal(signal.SIGINT,cancel)
    job.save(state='running',pid=os.getpid(),startedAt=time.time())
    try:job.run();job.save(state='passed',finishedAt=time.time())
    except BaseException as error:
        job.save(state='cancelled' if isinstance(error,Cancelled) else 'failed',message=str(error),finishedAt=time.time())
        job.log.write(type(error).__name__+': '+str(error)+'\n')
    finally:job.log.close();os.close(lock_fd)

def start(root,install,job,duration,maintenance):
    if job not in JOBS:raise ValueError('Unknown job.')
    if job in GPU_JOBS and not maintenance:raise ValueError('GPU jobs require --maintenance; production is restored afterward.')
    if not 1<=duration<=172800:raise ValueError('Duration must be 1–172800 seconds.')
    lock=acquire(root)
    try:
        if read(root/'maintenance.json',{}).get('active'):raise RuntimeError('Unfinished maintenance; run recover first.')
        previous=read(root/'latest.json',{}).get('id')
        if previous and status(root,previous)['state']=='interrupted' and not load_job(root,previous).get('recovered'):raise RuntimeError('Previous job interrupted; run recover first.')
        release=read(root/'release.json');source=root/'releases'/release['commit']
        inputs=read(source/'.debug-inputs.json')
        if not inputs:raise RuntimeError('Release source manifest missing; deploy a fresh revision.')
        for relative,digest in inputs.items():
            path=source/relative
            if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
                raise RuntimeError('Debug source was edited: '+relative+'. Commit changes and deploy a new revision.')
        job_id=uuid.uuid4().hex;folder=root/'runs'/job_id;folder.mkdir(mode=0o700)
        script=source/'scripts/debug/runner.py'
        meta={'id':job_id,'job':job,'state':'queued','createdAt':time.time(),'source':str(source),'commit':release['commit'],'runner':str(script),'install':str(install),'maintenance':maintenance,'duration':duration,'completedSteps':[]}
        write(folder/'manifest.json',meta);write(root/'latest.json',{'id':job_id})
        with (folder/'worker.log').open('ab') as log:
            child=subprocess.Popen([sys.executable,'-I',str(script),'worker','--root',str(root),'--install',str(install),'--id',job_id,'--lock-fd',str(lock.fileno())],stdin=subprocess.DEVNULL,stdout=log,stderr=log,pass_fds=(lock.fileno(),),start_new_session=True)
        _detached_children.append(child)
        # Worker owns manifest updates after spawn; separate PID prevents write races.
        write(folder/'process.json',{'pid':child.pid})
        return {'id':job_id,'state':'queued'}
    finally:lock.close()

def recover(root,install):
    with acquire(root):
        latest=read(root/'latest.json',{}).get('id')
        if latest:
            job=Job(root,install,latest)
            try:
                step=read(job.folder/'step-process.json',{})
                if step:
                    pid=step['pid'];proc=pathlib.Path('/proc')/str(pid)
                    if proc.exists():
                        argv=(proc/'cmdline').read_bytes().split(b'\0')
                        expected=step['argv']
                        if proc.stat().st_uid!=os.getuid() or not all(x.encode() in argv for x in expected[1:]) or os.getpgid(pid)!=pid:
                            raise RuntimeError('Step process identity mismatch; refusing recovery.')
                        executable=pathlib.Path(os.readlink(proc/'exe')).name
                        if pathlib.Path(expected[0]).name not in (executable,'npm'):
                            raise RuntimeError('Step executable identity mismatch.')
                        os.killpg(pid,signal.SIGTERM)
                        for _ in range(40):
                            if not proc.exists():break
                            time.sleep(.25)
                        else:raise RuntimeError('Orphan step did not stop; inspect it before recovery.')
                    (job.folder/'step-process.json').unlink(missing_ok=True)
                # Only this job's marked cluster and lab supervisor may be stopped.
                cluster=job.folder/'postgres'
                if (cluster/'.vani-debug-owned').exists() and (cluster/'postmaster.pid').exists():job.step('Recovery: stop test database',['pg_ctl','-D',cluster,'-m','fast','-w','stop'],90)
                script=job.source/'scripts/refresh-lab.py'
                if (job.source/'.vani-refresh-lab/.lab-owned').exists():job.step('Recovery: stop lab',[sys.executable,script,'stop'],90)
                model=read(root/'model-process.json',{})
                if model:
                    # Verify recorded binary, owner and exact loopback server environment.
                    pid=model.get('pid');proc=pathlib.Path('/proc')/str(pid)
                    if proc.exists():
                        argv=(proc/'cmdline').read_bytes().split(b'\0');environment_bytes=(proc/'environ').read_bytes().split(b'\0')
                        if proc.stat().st_uid!=os.getuid() or argv[:2]!=[model['binary'].encode(),b'serve'] or b'OLLAMA_HOST=127.0.0.1:11437' not in environment_bytes:raise RuntimeError('Debug model process identity mismatch; refusing to signal.')
                        os.kill(pid,signal.SIGTERM)
                        for _ in range(60):
                            if not proc.exists():break
                            time.sleep(.5)
                        else:raise RuntimeError('Debug model did not stop; production was not restarted.')
                    (root/'model-process.json').unlink(missing_ok=True)
                journal=read(root/'maintenance.json',{})
                if journal.get('active') and journal.get('restoreProduction'):
                    if journal.get('install')!=str(install):raise RuntimeError('Recovery installation path mismatch.')
                    job.restore_production()
                write(root/'maintenance.json',{'active':False,'restoreProduction':False})
                if job.meta['state'] in ('queued','running'):job.save(state='interrupted',message='Recovered; run may be retried.',recovered=True)
            finally:job.log.close()
    return {'recovered':True}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['run','worker','status','logs','cancel','recover']);parser.add_argument('--root',required=True);parser.add_argument('--install',required=True);parser.add_argument('--job',choices=JOBS,default='doctor');parser.add_argument('--id');parser.add_argument('--maintenance',action='store_true');parser.add_argument('--duration',type=int,default=3600);parser.add_argument('--lock-fd',type=int)
    args=parser.parse_args();os.umask(0o077);root,install=roots(args.root,args.install)
    if args.action=='run':result=start(root,install,args.job,args.duration,args.maintenance)
    elif args.action=='recover':result=recover(root,install)
    else:
        job_id=args.id or read(root/'latest.json',{}).get('id','')
        if args.action=='worker':return worker(root,install,job_id,args.lock_fd)
        result=status(root,job_id)
        if args.action=='logs':print((root/'runs'/job_id/'job.log').read_text()[-24000:]);return
        if args.action=='cancel':
            pid=result.get('pid') or read(root/'runs'/job_id/'process.json',{}).get('pid')
            if result['state'] not in ('queued','running') or not process_matches(pid,result['runner'],job_id):raise RuntimeError('Job is not active or process identity differs.')
            os.kill(pid,signal.SIGTERM);result={'id':job_id,'cancellationRequested':True}
    print(json.dumps(result,indent=2))

if __name__=='__main__':
    try:main()
    except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
