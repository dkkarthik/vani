#!/usr/bin/env python3
"""Ubuntu dependency planner/installer. Check and dry-run perform no mutations."""
import argparse, datetime, fcntl, hashlib, json, os, pathlib, platform, secrets, shlex, shutil, subprocess, sys, tempfile, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / 'scripts/setup/dependencies.json').read_text())
STATE = pathlib.Path(os.environ.get('XDG_DATA_HOME', str(pathlib.Path.home()/'.local/share'))) / 'vani'

def env_data(path):
    result = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'): continue
            if '=' not in line: raise ValueError('Invalid environment configuration line')
            key, value = line.split('=', 1)
            if not key.replace('_', '').isalnum(): raise ValueError('Invalid environment key')
            if len(value)>1 and value[0]==value[-1] and value[0] in "\"'": value=value[1:-1]
            result[key] = value
    return result

def command(args, **kw):
    return subprocess.run([str(a) for a in args], check=True, **kw)

def output(args):
    try: return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=8).strip()
    except (OSError, subprocess.SubprocessError): return None

def read_url(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as response: return json.load(response)

def report(args):
    release = env_data(pathlib.Path('/etc/os-release')) if pathlib.Path('/etc/os-release').exists() else {}
    supported = platform.system()=='Linux' and release.get('ID')=='ubuntu' and release.get('VERSION_ID') in MANIFEST['ubuntu'] and platform.machine()==MANIFEST['architecture']
    node = STATE/'runtime/node/bin/node'
    node_version = output([str(node if node.exists() else 'node'), '--version'])
    node_ok = bool(node_version and int(node_version.lstrip('v').split('.')[0]) >= 22)
    settings = env_data(ROOT/'.env')
    base=settings.get('OLLAMA_BASE_URL','http://127.0.0.1:11435')
    from urllib.parse import urlparse
    parsed=urlparse(base)
    if parsed.hostname not in ('127.0.0.1','localhost','::1') or parsed.scheme not in ('http','https') or parsed.username: raise ValueError('Ollama must use a loopback endpoint')
    model=settings.get('OLLAMA_MODEL',MANIFEST['models'].get(args.profile,''))
    try: inventory=read_url(base+'/api/tags').get('models',[])
    except Exception: inventory=[]
    installed={m.get('name'):m.get('digest') for m in inventory if not m.get('remote_host') and not m.get('remote_model')}
    gpu=output(['nvidia-smi','--query-gpu=name,memory.total,driver_version','--format=csv,noheader,nounits'])
    checks=[{'name':'ubuntu','ready':supported,'detail':release.get('PRETTY_NAME',platform.system()),'fix':'Use a supported Ubuntu x86_64 host.'},
      {'name':'node','ready':node_ok,'detail':node_version,'fix':'Install pinned private Node runtime.'},
      {'name':'docker','ready':bool(output(['docker','info','--format','{{.ServerVersion}}'])),'fix':'Install/start Docker; grant this user access or use sudo during installation.'},
      {'name':'poppler','ready':bool(shutil.which('pdftotext')),'fix':'Install poppler-utils.'},
      {'name':'disk','ready':shutil.disk_usage(ROOT).free >= (15 if args.profile=='app' else 80)*1024**3,'fix':'Free 15 GiB for app or 80 GiB for local models and research cache.'},
      {'name':'dependencies','ready':(ROOT/'node_modules').exists(),'fix':'Run npm ci.'},
      {'name':'build','ready':(ROOT/'apps/api/dist/index.js').exists() and (ROOT/'apps/web/dist/index.html').exists(),'fix':'Run npm run build.'}]
    if args.profile!='app':
        ram=os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES') if supported else 0
        checks += [{'name':'ram','ready':ram >= (60 if args.profile=='local-5090' else 16)*1024**3,'fix':'5090 profile requires nominal 64 GB RAM; small profile 16 GiB.'},
          {'name':'gpu','ready':bool(gpu and (args.profile!='local-5090' or any('5090' in line and float(line.split(',')[1])>=30000 for line in gpu.splitlines()))),'detail':gpu,'fix':'Install an Ubuntu-recommended NVIDIA driver; reboot. CUDA toolkit is not required.'},
          {'name':'reader','ready':bool(installed.get(model) or installed.get(model+':latest')),'detail':model,'fix':'Start local Ollama and pull the configured reader.'},
          {'name':'embedding','ready':bool(installed.get(settings.get('OLLAMA_EMBED_MODEL',MANIFEST['models']['embedding']))),'fix':'Pull the embedding model.'}]
    try:
        health=read_url('http://127.0.0.1:'+settings.get('VANI_API_PORT','8080')+'/api/v1/system/health')
        if health['database']['state']=='ready' and (STATE/'compose.json').exists():
            next(c for c in checks if c['name']=='docker')['ready']=True
        checks += [{'name':'database','ready':health['database']['state']=='ready','fix':'Start PostgreSQL and run migrations after backing up existing data.'}]
    except Exception: checks += [{'name':'database','ready':False,'fix':'Start VANI; verify database access and migrations.'}]
    if args.check_network:
        for host in ('https://nodejs.org','https://api.openalex.org','https://ollama.com'):
            try:
                with urllib.request.urlopen(host,timeout=8) as r: ready=r.status<400
            except Exception: ready=False
            checks.append({'name':'network '+host,'ready':ready,'fix':'Check outbound HTTPS/proxy configuration.'})
    return {'schemaVersion':1,'profile':args.profile,'supported':supported,'checks':checks,'ready':all(c['ready'] for c in checks),'models':installed,'hardwareAcceptance':'not certified by static checks'}

def plan(args):
    steps=['Check Ubuntu, architecture, disk and existing configuration', 'Install missing Ubuntu packages via apt (sudo)', 'Install checksum-verified private Node runtime', 'Preserve .env; create private defaults only for missing keys', 'Start loopback PostgreSQL in a dedicated Docker project', 'Back up an existing database before migrations', 'Run npm ci, build and database migrations as current user', 'Install user-owned VANI service and loopback web server']
    if args.profile!='app': steps += ['Install checksum-verified private Ollama runtime and user service on port 11435', 'Pull reader and embedding models unless --skip-models', 'Record actual image/model digests; report health']
    if args.install_driver: steps.insert(2,'Install Ubuntu-recommended NVIDIA driver; stop if reboot is required')
    return steps

def private_write(path,text):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f: f.write(text)

def download_runtime(name):
    spec=MANIFEST[name];dest=STATE/'runtime'/name
    marker=dest/'.vani-version'
    if marker.exists() and marker.read_text()==spec['version']: return
    if dest.exists(): raise RuntimeError('A different runtime exists at '+str(dest)+'. Preserve or move it before upgrading.')
    with tempfile.TemporaryDirectory(dir=STATE) as temp:
        archive=pathlib.Path(temp)/'archive'
        with urllib.request.urlopen(spec['url'],timeout=60) as response, archive.open('wb') as f: shutil.copyfileobj(response,f)
        h=hashlib.sha256()
        with archive.open('rb') as f:
            for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
        if h.hexdigest()!=spec['sha256']: raise RuntimeError(name+' archive checksum mismatch')
        extracted=pathlib.Path(temp)/'extracted';extracted.mkdir()
        command(['tar','-xf',archive,'-C',extracted]+(['--strip-components=1'] if name=='node' else []))
        dest.parent.mkdir(parents=True,exist_ok=True);extracted.rename(dest)
        marker.write_text(spec['version'])

def systemd_quote(s): return '"'+str(s).replace('\\','\\\\').replace('"','\\"').replace('%','%%')+'"'

def service(name,executable,args,environment=None):
    directory=pathlib.Path.home()/'.config/systemd/user';path=directory/name
    if path.exists() and '# Owned by VANI setup' not in path.read_text(): raise RuntimeError('Refusing to overwrite an unmanaged service: '+str(path))
    text='# Owned by VANI setup\n[Unit]\nDescription=VANI local research service\nAfter=network-online.target\n[Service]\nType=simple\nExecStart='+ ' '.join(systemd_quote(s) for s in [executable,*args])+'\nWorkingDirectory='+systemd_quote(ROOT)+'\nRestart=on-failure\nRestartSec=5\nUMask=0077\n'
    for key,value in (environment or {}).items(): text+='Environment='+systemd_quote(key+'='+value)+'\n'
    text+='\n[Install]\nWantedBy=default.target\n';private_write(path,text)
    command(['systemctl','--user','daemon-reload']);command(['systemctl','--user','enable',name]);command(['systemctl','--user','restart',name])

def install(args):
    if os.geteuid()==0: raise RuntimeError('Run as your normal user; the installer invokes sudo only for system dependencies.')
    initial=report(args)
    if not initial['supported']: return 3
    if not next(c['ready'] for c in initial['checks'] if c['name']=='disk'): raise RuntimeError('Insufficient free disk space.')
    if not args.yes:
        print('\n'.join(plan(args)))
        if input('Install these dependencies and VANI services? [y/N] ').lower()!='y': return 2
    STATE.mkdir(parents=True,exist_ok=True);os.chmod(STATE,0o700)
    with (STATE/'install.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        journal_path=STATE/'install-journal.json'
        journal=json.loads(journal_path.read_text()) if args.resume and journal_path.exists() else {'started':datetime.datetime.now(datetime.timezone.utc).isoformat(),'completed':[]}
        def step(name,fn):
            journal['current']=name;private_write(journal_path,json.dumps(journal,indent=2));fn();journal['completed'].append(name);private_write(journal_path,json.dumps(journal,indent=2))
        packages=MANIFEST['packages']+(['git','build-essential'] if args.with_dev_tools else [])+(['ubuntu-drivers-common'] if args.install_driver else [])
        step('Ubuntu packages',lambda:(command(['sudo','apt-get','update']),command(['sudo','apt-get','install','-y',*packages])))
        if args.install_driver:
            command(['sudo','ubuntu-drivers','install'])
            if pathlib.Path('/var/run/reboot-required').exists(): print('Driver installed. Reboot, then rerun --install --resume.');return 4
        step('Node',lambda:download_runtime('node'))
        env=os.environ.copy();env['PATH']=str(STATE/'runtime/node/bin')+os.pathsep+env.get('PATH','')
        settings=env_data(ROOT/'.env');password=secrets.token_urlsafe(32)
        defaults={'NODE_ENV':'production','VANI_DEMO_MODE':'false','VANI_API_HOST':'127.0.0.1','VANI_API_PORT':'8080','VANI_WEB_ORIGIN':'http://127.0.0.1:3000','DATABASE_URL':f'postgres://vani:{password}@127.0.0.1:5432/vani','VANI_DATA_DIR':str(STATE/'data'),'VANI_CLOUD_MODE':'off','OLLAMA_BASE_URL':'http://127.0.0.1:11435','OLLAMA_MODEL':MANIFEST['models'].get(args.profile,MANIFEST['models']['local-small']),'OLLAMA_EMBED_MODEL':MANIFEST['models']['embedding'],'VANI_EMBED_MODEL':MANIFEST['models']['embedding']}
        new_database='DATABASE_URL' not in settings
        owner=STATE/'workspace'
        if owner.exists() and owner.read_text()!=str(ROOT): raise RuntimeError('This VANI installation directory belongs to another checkout.')
        private_write(owner,str(ROOT))
        missing={k:v for k,v in defaults.items() if k not in settings}
        previous=(ROOT/'.env').read_text() if (ROOT/'.env').exists() else ''
        settings.update(missing);env.update(settings)
        docker=['docker'] if output(['docker','info','--format','{{.ServerVersion}}']) else ['sudo','docker']
        if new_database and not (STATE/'compose.json').exists():
            compose={'services':{'postgres':{'image':MANIFEST['postgres'],'restart':'unless-stopped','environment':{'POSTGRES_USER':'vani','POSTGRES_PASSWORD':password,'POSTGRES_DB':'vani'},'ports':['127.0.0.1:5432:5432'],'volumes':['vani-data:/var/lib/postgresql'],'healthcheck':{'test':['CMD-SHELL','pg_isready -U vani -d vani'],'interval':'2s','timeout':'3s','retries':30}}},'volumes':{'vani-data':{}}}
            private_write(STATE/'compose.json',json.dumps(compose))
        elif new_database and (STATE/'compose.json').exists():
            saved=json.loads((STATE/'compose.json').read_text())['services']['postgres']['environment']
            settings['DATABASE_URL']=missing['DATABASE_URL']=f"postgres://vani:{saved['POSTGRES_PASSWORD']}@127.0.0.1:5432/vani";env.update(settings)
        private_write(ROOT/'.env',previous+ ('\n' if previous and not previous.endswith('\n') else '')+'\n'.join(k+'='+v for k,v in missing.items())+'\n')
        if (STATE/'compose.json').exists():
            step('PostgreSQL',lambda:command([*docker,'compose','-p','vani-local','-f',STATE/'compose.json','up','-d','--wait']))
        # Always back up before migrations, including resumed/upgrade installs. Credentials stay in process environment.
        backup=STATE/'backups'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S.sql');backup.parent.mkdir(exist_ok=True)
        def backup_database():
            pg_env=env.copy();pg_env['PGDATABASE']=settings['DATABASE_URL']
            with backup.open('wb') as f:
                os.chmod(backup,0o600)
                if (STATE/'compose.json').exists():
                    command([*docker,'compose','-p','vani-local','-f',STATE/'compose.json','exec','-T','postgres','pg_dump','-U','vani','-d','vani','--no-owner','--no-acl'],stdout=f)
                else: command(['pg_dump','--no-owner','--no-acl'],env=pg_env,stdout=f)
        step('Database backup',backup_database)
        step('Application dependencies',lambda:command(['npm','ci'],cwd=ROOT,env=env))
        step('Build',lambda:command(['npm','run','build'],cwd=ROOT,env=env))
        step('Migrations',lambda:command(['npm','run','db:migrate'],cwd=ROOT,env=env))
        if args.profile!='app':
            step('Ollama',lambda:download_runtime('ollama'))
            if settings['OLLAMA_BASE_URL']=='http://127.0.0.1:11435':
                step('Ollama service',lambda:service('vani-ollama.service',STATE/'runtime/ollama/bin/ollama',['serve'],{'OLLAMA_HOST':'127.0.0.1:11435','OLLAMA_NO_CLOUD':'1','OLLAMA_NUM_PARALLEL':'1','OLLAMA_MAX_LOADED_MODELS':'1','OLLAMA_MODELS':str(STATE/'models')}))
            for attempt in range(20):
                try: read_url(settings['OLLAMA_BASE_URL']+'/api/tags');break
                except Exception:
                    if attempt==19: raise RuntimeError('Ollama service did not become ready; inspect journalctl --user -u vani-ollama.')
                    time.sleep(1)
            if not args.skip_models:
                model_env=env.copy();model_env['OLLAMA_HOST']=settings['OLLAMA_BASE_URL']
                for model in [settings['OLLAMA_MODEL'],settings['OLLAMA_EMBED_MODEL']]:
                    step('Pull '+model,lambda model=model:command([STATE/'runtime/ollama/bin/ollama','pull',model],env=model_env))
        step('VANI service',lambda:service('vani.service',sys.executable,[ROOT/'scripts/setup/launch.py']))
        for attempt in range(20):
            try: read_url('http://127.0.0.1:'+settings.get('VANI_API_PORT','8080')+'/api/v1/health');break
            except Exception: time.sleep(1)
        final=report(args);private_write(STATE/'health.json',json.dumps(final,indent=2))
        try:
            digest=output([*docker,'image','inspect',MANIFEST['postgres'],'--format','{{json .RepoDigests}}'])
            private_write(STATE/'installed-versions.json',json.dumps({'manifest':MANIFEST,'databaseDigest':digest,'models':final['models']},indent=2))
        except Exception: pass
        print('VANI: http://127.0.0.1:3000 · Health: '+str(STATE/'health.json'))
        print('User services start at login. For unattended boot, explicitly enable user lingering with loginctl enable-linger.')
        return 0 if final['ready'] else 2

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);m=p.add_mutually_exclusive_group()
    for name in ('check','dry-run','install'): m.add_argument('--'+name,action='store_true')
    p.add_argument('--profile',choices=['app','local-5090','local-small'],default='local-5090')
    for name in ('check-network','resume','json','yes','skip-models','with-dev-tools','install-driver'):p.add_argument('--'+name,action='store_true')
    args=p.parse_args(argv)
    if not any((args.check,args.dry_run,args.install)):p.print_help();return 0
    if (args.install_driver or args.resume or args.skip_models or args.yes or args.with_dev_tools) and not args.install:p.error('Installation modifiers require --install')
    try:
        if args.install:return install(args)
        result=report(args)
        if args.dry_run:result['plan']=plan(args)
        print(json.dumps(result,indent=2) if args.json else '\n'.join(('OK ' if c['ready'] else 'NEEDS ') + c['name'] + ('' if c['ready'] else ': '+c['fix']) for c in result['checks'])+ ('\n'+'\n'.join(result.get('plan',[])) if args.dry_run else ''))
        return 3 if not result['supported'] else 0 if result['ready'] else 2
    except Exception as e:print('Setup failed: '+str(e),file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
