#!/usr/bin/env python3
"""Rootless Ubuntu installer. Check/dry-run report all prerequisites without writes."""
import argparse, datetime, fcntl, hashlib, json, os, pathlib, platform, secrets, shutil, socket, subprocess, sys, tarfile, tempfile, time, urllib.request
from urllib.parse import urlparse, unquote
ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / 'scripts/setup/dependencies.json').read_text())
STATE = pathlib.Path.home() / 'vani'
APP = STATE / 'app'
CONFIG = STATE / 'config/vani.env'
PREFIX = STATE / 'runtime/deps'


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


def output(args, **kw):
    try: return subprocess.check_output([str(a) for a in args], text=True, stderr=subprocess.DEVNULL, timeout=8, **kw).strip()
    except (OSError, subprocess.SubprocessError): return None


def read_url(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as response: return json.load(response)


def runtime_env(settings=None):
    env = os.environ.copy()
    env.update(settings or {})
    env.update({'PATH':os.pathsep.join([str(STATE/'runtime/node/bin'),str(PREFIX/'bin'),env.get('PATH','')]),
                'MAMBA_ROOT_PREFIX':str(STATE/'cache/mamba'),
                'CONDA_PKGS_DIRS':str(STATE/'cache/conda/pkgs'), 'CONDA_ENVS_PATH':str(STATE/'runtime'),
                'CONDA_REGISTER_ENVS':'false', 'CONDA_SUBDIR':'linux-64', 'CONDA_ROOT_PREFIX':str(STATE/'runtime/conda'),
                'CONDARC':str(STATE/'config/condarc'), 'XDG_CACHE_HOME':str(STATE/'cache'),
                'npm_config_cache':str(STATE/'cache/npm'), 'TMPDIR':str(STATE/'tmp'),
                'OLLAMA_MODELS':str(STATE/'models'), 'PYTHONDONTWRITEBYTECODE':'1'})
    return env


def postgres_env(settings, database_name='vani'):
    env={k:v for k,v in runtime_env(settings).items() if not k.startswith('PG')}
    db=urlparse(settings['DATABASE_URL'])
    env.update({'PGHOST':db.hostname, 'PGPORT':str(db.port), 'PGUSER':unquote(db.username),
                'PGPASSWORD':unquote(db.password), 'PGDATABASE':database_name, 'PGCONNECT_TIMEOUT':'5'})
    return env


def legacy_paths():
    paths = [ROOT/'.env', pathlib.Path.home()/'.local/share/vani/workspace']
    xdg = os.environ.get('XDG_DATA_HOME')
    if xdg: paths.append(pathlib.Path(xdg)/'vani/workspace')
    return [str(p) for p in paths if p.exists()] if not CONFIG.exists() else []


def validate_settings(settings):
    expected = {'VANI_DATA_DIR':str(STATE/'data'), 'OLLAMA_BASE_URL':'http://127.0.0.1:11435'}
    for key, value in expected.items():
        if settings.get(key) != value: raise ValueError(key+' must be '+value+' for this home-folder installation.')
    db=urlparse(settings.get('DATABASE_URL',''))
    if db.scheme not in ('postgres','postgresql') or db.hostname!='127.0.0.1' or db.port!=55432 or db.path!='/vani' or db.username!='vani' or not db.password or db.query:
        raise ValueError('DATABASE_URL must use the managed vani database at 127.0.0.1:55432 with its saved password.')
    if settings.get('VANI_API_HOST')!='127.0.0.1': raise ValueError('VANI_API_HOST must be 127.0.0.1.')


def report(args):
    release=env_data(pathlib.Path('/etc/os-release')) if pathlib.Path('/etc/os-release').exists() else {}
    supported=platform.system()=='Linux' and release.get('ID')=='ubuntu' and release.get('VERSION_ID') in MANIFEST['ubuntu'] and platform.machine()==MANIFEST['architecture']
    checks=[]
    def add(name, ready, kind, fix, detail=None):
        checks.append({'name':name,'ready':bool(ready),'kind':kind,'fix':fix,'detail':detail})
    add('ubuntu',supported,'host','Use a supported Ubuntu x86_64 host.',release.get('PRETTY_NAME',platform.system()))
    modules=[]
    for module in ('ssl','bz2','lzma'):
        try: __import__(module)
        except ImportError: modules.append(module)
    add('python',sys.version_info >= (3,10) and not modules,'host','Provide Python 3.10+ with SSL, bz2 and lzma modules.',sys.version.split()[0]+'; missing modules: '+', '.join(modules))
    try:
        import ssl
        trust=ssl.get_default_verify_paths();has_trust=bool(trust.cafile or trust.capath)
    except ImportError: has_trust=False
    add('https-trust',has_trust,'host','Provide HTTPS CA certificates (SSL_CERT_FILE can point to a user-owned CA bundle).')
    parent=STATE
    while not parent.exists(): parent=parent.parent
    add('home-path',not STATE.is_symlink(),'host','~/vani must be a real directory, not a symlink to another data location.')
    add('home-writable',os.access(parent,os.W_OK|os.X_OK),'host','Provide write access to ~/vani.',str(STATE))
    add('disk',shutil.disk_usage(parent).free >= (15 if args.profile=='app' else 80)*1024**3,'host','Free 15 GiB (app) or 80 GiB (local models) on the home filesystem.')
    legacy=legacy_paths()
    add('legacy-data',not legacy,'host','Existing installation detected. Export/back up its database and files, then migrate explicitly; see the installation guide. Source .env is never silently imported.',legacy)
    config_error=None
    try: settings=env_data(CONFIG)
    except ValueError as e: settings={};config_error=str(e)
    if settings:
        try: validate_settings(settings)
        except ValueError as e: config_error=str(e)
    add('configuration',not config_error,'host','Correct the managed configuration before installing.',config_error)
    env=runtime_env(settings)
    for name, binary, version_args in [('node','node',['--version']),('npm','npm',['--version']),('postgresql','postgres',['--version']),('pg-dump','pg_dump',['--version']),('poppler','pdftotext',['-v']),('tar','tar',['--version']),('xz','xz',['--version']),('zstd','zstd',['--version'])]:
        binary_path=shutil.which(binary,path=env['PATH'])
        version=output([binary_path,*version_args],env=env) if binary_path else None
        ready=bool(binary_path)
        if name=='node':
            try: ready=tuple(int(v) for v in (version or '').lstrip('v').split('.')) >= (22,22,0)
            except ValueError: ready=False
        if name in ('postgresql','pg-dump'): ready=bool(version and version.split()[-1].split('.')[0]=='18')
        add(name,ready,'local','Install the managed user-space runtime under ~/vani/runtime.',version or binary_path)
    share=output([PREFIX/'bin/pg_config','--sharedir'],env=env)
    for extension in ('vector','pg_trgm'):
        add(extension,bool(share and (pathlib.Path(share)/'extension'/f'{extension}.control').exists()),'local','Install PostgreSQL 18 and matching pgvector in the private environment.')
    add('private-environment',(PREFIX/'conda-meta/history').exists(),'local','Provision the isolated PostgreSQL/Poppler/archive-tool environment; system programs are only inventoried, never modified.')
    add('micromamba',(STATE/'runtime/micromamba/bin/micromamba').exists(),'local','Download the checksum-verified private package bootstrap.')
    add('conda',(STATE/'runtime/conda/standalone_conda/conda.exe').exists(),'local','Install checksum-verified standalone Conda with environment registration disabled.')
    add('dependencies',(APP/'node_modules').exists(),'setup','Install application packages with npm ci under ~/vani/app.')
    add('build',(APP/'apps/api/dist/index.js').exists() and (APP/'apps/web/dist/index.html').exists(),'setup','Build the private application snapshot.')
    installed={}
    if args.profile!='app':
        ram=os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES') if platform.system()=='Linux' else 0
        gpu=output(['nvidia-smi','--query-gpu=name,memory.total,driver_version','--format=csv,noheader,nounits'])
        add('ram',ram >= (60 if args.profile=='local-5090' else 16)*1024**3,'host','Use nominal 64 GB RAM for local-5090 or 16 GiB for local-small.')
        gpu_ok=bool(gpu)
        if args.profile=='local-5090':
            try: gpu_ok=bool(gpu and any('5090' in line and float(line.split(',')[1])>=30000 for line in gpu.splitlines()))
            except (ValueError,IndexError): gpu_ok=False
        add('gpu',gpu_ok,'host','Ask the system administrator for a working NVIDIA driver/GPU. VANI cannot install kernel drivers without privileges; no CUDA toolkit is needed.',gpu)
        add('ollama',(STATE/'runtime/ollama/bin/ollama').exists(),'local','Install the pinned private Ollama runtime.')
        try: inventory=read_url('http://127.0.0.1:11435/api/tags').get('models',[])
        except Exception: inventory=[]
        installed={m.get('name'):m.get('digest') for m in inventory if not m.get('remote_host') and not m.get('remote_model')}
        for name, model in [('reader',settings.get('OLLAMA_MODEL',MANIFEST['models'][args.profile])),('embedding',settings.get('OLLAMA_EMBED_MODEL',MANIFEST['models']['embedding']))]:
            add(name,bool(installed.get(model) or installed.get(model+':latest')),'setup','Pull the local model into ~/vani/models.',model)
    try:
        health=read_url('http://127.0.0.1:'+settings.get('VANI_API_PORT','8080')+'/api/v1/system/health')
        db_ready=health['database']['state']=='ready' and (STATE/'postgres/PG_VERSION').exists()
    except Exception: db_ready=False
    add('database',db_ready,'setup','Initialize/start the private PostgreSQL cluster and run backed-up migrations.')
    if args.check_network:
        for host in ('https://nodejs.org','https://conda.anaconda.org/conda-forge','https://ollama.com','https://api.openalex.org'):
            try:
                with urllib.request.urlopen(host,timeout=8) as r: ready=r.status<400
            except Exception: ready=False
            add('network '+host,ready,'host','Allow outbound HTTPS or configure the user proxy/CA bundle.')
    missing=[c for c in checks if not c['ready']]
    return {'schemaVersion':2,'profile':args.profile,'root':str(STATE),'supported':supported,'checks':checks,'missing':missing,'blockers':[c for c in missing if c['kind']=='host'],'ready':not missing,'models':installed,'hardwareAcceptance':'not certified by static checks'}


def plan(args):
    steps=['Report every missing dependency and host blocker before making changes', 'Install checksum-verified private archive bootstrap, standalone Conda and Node', 'Resolve PostgreSQL 18, pgvector, Poppler and archive tools into ~/vani/runtime/deps', 'Copy application to ~/vani/app; keep private settings in ~/vani/config/vani.env', 'Initialize SCRAM-authenticated PostgreSQL on 127.0.0.1:55432 with data in ~/vani/postgres', 'Back up the managed database; install npm packages, build and migrate', 'Start user-owned processes using ~/vani/bin/vani; logs in ~/vani/logs']
    if args.profile!='app': steps += ['Install private Ollama; pull models into ~/vani/models unless --skip-models']
    return steps


def print_report(result, as_json=False):
    if as_json: print(json.dumps(result,indent=2)); return
    print('Installation folder: '+str(STATE))
    for c in result['checks']:
        print(('OK ' if c['ready'] else 'MISSING ')+c['name']+' ['+c['kind']+']'+('' if c['ready'] else ': '+c['fix']))
    print(str(len(result.get('missing',[])))+' missing items; '+str(len(result.get('blockers',[])))+' host blockers. Local/setup items are installed without privileges.')
    for step in result.get('plan',[]): print('  '+step)


def private_write(path,text):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.is_symlink(): raise RuntimeError('Refusing a symlink for private file: '+str(path))
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    os.fchmod(fd,0o600)
    with os.fdopen(fd,'w') as f: f.write(text)


def download_runtime(name):
    spec=MANIFEST[name];dest=STATE/'runtime'/name;marker=dest/'.vani-version'
    if marker.exists() and marker.read_text()==spec['version']: return
    if dest.exists(): raise RuntimeError('A different/incomplete runtime exists at '+str(dest)+'. Preserve or move it before upgrading.')
    with tempfile.TemporaryDirectory(dir=STATE/'tmp') as temp:
        archive=pathlib.Path(temp)/('archive.conda' if name=='conda' else 'archive')
        with urllib.request.urlopen(spec['url'],timeout=60) as response, archive.open('wb') as f: shutil.copyfileobj(response,f)
        h=hashlib.sha256()
        with archive.open('rb') as f:
            for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
        if h.hexdigest()!=spec['sha256']: raise RuntimeError(name+' archive checksum mismatch')
        extracted=pathlib.Path(temp)/'extracted';extracted.mkdir()
        if name=='micromamba':
            with tarfile.open(archive,'r:bz2') as tf:
                member=tf.getmember('bin/micromamba')
                if not member.isfile(): raise RuntimeError('Invalid micromamba archive')
                target=extracted/'bin/micromamba';target.parent.mkdir()
                with tf.extractfile(member) as src,target.open('wb') as dst: shutil.copyfileobj(src,dst)
                target.chmod(0o700)
        elif name=='conda':
            command([STATE/'runtime/micromamba/bin/micromamba','--no-rc','--no-env','package','extract',archive,extracted],env=runtime_env())
        else:
            command([PREFIX/'bin/tar','-xf',archive,'-C',extracted]+(['--strip-components=1'] if name=='node' else []),env=runtime_env())
        dest.parent.mkdir(parents=True,exist_ok=True);extracted.rename(dest);marker.write_text(spec['version'])


def install_environment():
    conda=STATE/'runtime/conda/standalone_conda/conda.exe'
    # Standalone Conda can disable ~/.conda/environments.txt registration. Micromamba
    # is used only to extract its archive, never to create an environment.
    private_write(STATE/'config/condarc', 'channels: [conda-forge]\nregister_envs: false\nauto_activate_base: false\nnotify_outdated_conda: false\n')
    if not (PREFIX/'conda-meta/history').exists():
        command([conda,'create','-y','-p',PREFIX,'--override-channels','-c','conda-forge','--no-default-packages',*MANIFEST['localPackages']],env=runtime_env())
    with (STATE/'installed-packages.txt').open('w') as f:
        command([conda,'list','-p',PREFIX,'--explicit'],env=runtime_env(),stdout=f)
    for binary in ('postgres','initdb','pg_ctl','pg_dump','psql','pg_config','pdftotext','tar','xz','zstd'):
        if not (PREFIX/'bin'/binary).exists(): raise RuntimeError('Private environment is incomplete: '+binary)
    version=output([PREFIX/'bin/postgres','--version'],env=runtime_env())
    if not version or version.split()[-1].split('.')[0]!='18': raise RuntimeError('Private PostgreSQL must be version 18.')
    share=output([PREFIX/'bin/pg_config','--sharedir'],env=runtime_env())
    for extension in ('vector','pg_trgm'):
        if not share or not (pathlib.Path(share)/'extension'/f'{extension}.control').exists(): raise RuntimeError('Missing PostgreSQL extension '+extension)


def snapshot():
    if ROOT.resolve()==APP.resolve(): return
    if APP.exists() and not (APP/'.vani-owned').exists(): raise RuntimeError('Refusing to overwrite an unmanaged ~/vani/app.')
    staging=STATE/'app-staging'
    if staging.exists(): shutil.rmtree(staging)
    staging.mkdir()
    for path in ROOT.iterdir():
        if path.name in ('apps','packages','scripts'):
            shutil.copytree(path,staging/path.name,ignore=shutil.ignore_patterns('node_modules','dist','.env','__pycache__','*.pyc'))
        elif path.is_file() and (path.suffix in ('.json','.js','.mjs') or path.name=='.npmrc'):
            shutil.copy2(path,staging/path.name)
    private_write(staging/'.vani-owned','rootless-v1')
    previous=STATE/'app-previous'
    if previous.exists(): shutil.rmtree(previous)
    if APP.exists(): APP.rename(previous)
    staging.rename(APP)


def configure(args):
    if CONFIG.exists():
        settings=env_data(CONFIG);validate_settings(settings)
        return settings
    password=secrets.token_urlsafe(32)
    settings={'NODE_ENV':'production','VANI_DEMO_MODE':'false','VANI_API_HOST':'127.0.0.1','VANI_API_PORT':'8080','VANI_WEB_ORIGIN':'http://127.0.0.1:3000','DATABASE_URL':f'postgres://vani:{password}@127.0.0.1:55432/vani','VANI_DATA_DIR':str(STATE/'data'),'VANI_CLOUD_MODE':'off','OLLAMA_BASE_URL':'http://127.0.0.1:11435','OLLAMA_MODEL':MANIFEST['models'].get(args.profile,MANIFEST['models']['local-small']),'OLLAMA_EMBED_MODEL':MANIFEST['models']['embedding'],'VANI_EMBED_MODEL':MANIFEST['models']['embedding']}
    private_write(CONFIG,'\n'.join(k+'='+v for k,v in settings.items())+'\n')
    return settings


def pg_options(): return "-h 127.0.0.1 -p 55432 -k ''"


def database(settings, migrate):
    cluster=STATE/'postgres';env=postgres_env(settings)
    if cluster.exists() and not (cluster/'.vani-owned').exists(): raise RuntimeError('Refusing to use an unmanaged ~/vani/postgres cluster.')
    fresh=not (cluster/'PG_VERSION').exists()
    if not fresh and (cluster/'PG_VERSION').read_text().strip()!='18': raise RuntimeError('Existing cluster requires an explicit PostgreSQL major-version migration.')
    if fresh:
        # Initialize off to the side so interruptions cannot leave a trusted partial cluster.
        pending=STATE/'postgres-init'
        if pending.exists(): shutil.rmtree(pending)
        pw=STATE/'tmp/pg-password'
        private_write(pw,unquote(urlparse(settings['DATABASE_URL']).password)+'\n')
        try: command([PREFIX/'bin/initdb','-D',pending,'-U','vani','--pwfile',pw,'--auth=scram-sha-256','--encoding=UTF8','--locale=C'],env=env)
        finally: pw.unlink(missing_ok=True)
        private_write(pending/'.vani-owned','rootless-v1')
        pending.rename(cluster)
    # Fail on port conflicts; never attach to an unrelated server.
    with socket.socket() as probe: probe.bind(('127.0.0.1',55432))
    started=False
    try:
        command([PREFIX/'bin/pg_ctl','-D',cluster,'-l',STATE/'logs/postgres.log','-o',pg_options(),'-w','start'],env=env)
        started=True
        admin=postgres_env(settings,'postgres')
        exists=output([PREFIX/'bin/psql','-X','-Atc',"SELECT 1 FROM pg_database WHERE datname='vani'"],env=admin)
        if exists is None: raise RuntimeError('Unable to authenticate to managed PostgreSQL.')
        if exists!='1': command([PREFIX/'bin/psql','-X','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE vani'],env=admin)
        extensions=output([PREFIX/'bin/psql','-X','-Atc',"SELECT count(*) FROM pg_available_extensions WHERE name IN ('vector','pg_trgm')"],env=env)
        if extensions!='2': raise RuntimeError('Managed PostgreSQL lacks vector or pg_trgm.')
        backup=STATE/'backups'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f.sql')
        with backup.open('wb') as f:
            os.chmod(backup,0o600);command([PREFIX/'bin/pg_dump','--no-owner','--no-acl'],env=env,stdout=f)
        migrate()
    finally:
        if started or (cluster/'postmaster.pid').exists():
            command([PREFIX/'bin/pg_ctl','-D',cluster,'-m','fast','-w','stop'],env=env)


def install(args):
    initial=report(args);initial['plan']=plan(args);print_report(initial,args.json)
    if not initial['supported']: return 3
    if initial['blockers']: return 2
    if os.geteuid()==0: raise RuntimeError('Run as your normal user. Root installations are not supported.')
    if not args.yes and input('Install the listed items into ~/vani? [y/N] ').lower()!='y': return 2
    os.umask(0o077)
    STATE.mkdir(parents=True,exist_ok=True);STATE.chmod(0o700)
    # Reject managed directory symlinks instead of writing outside the requested root.
    for name in ('runtime','config','data','models','cache','tmp','logs','backups','bin','postgres','app','app-staging','app-previous'):
        if (STATE/name).is_symlink(): raise RuntimeError('Managed path must not be a symlink: '+str(STATE/name))
    for name in ('runtime','config','data','models','cache','tmp','logs','backups','bin'): (STATE/name).mkdir(exist_ok=True,mode=0o700)
    with (STATE/'install.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        journal_path=STATE/'install-journal.json'
        journal=json.loads(journal_path.read_text()) if args.resume and journal_path.exists() else {'started':datetime.datetime.now(datetime.timezone.utc).isoformat(),'completed':[]}
        def step(name,fn):
            print(name,flush=True);journal['current']=name;private_write(journal_path,json.dumps(journal,indent=2));fn();journal['completed'].append(name);private_write(journal_path,json.dumps(journal,indent=2))
        if (APP/'scripts/setup/control.py').exists(): command([sys.executable,APP/'scripts/setup/control.py','stop'])
        # Serialize upgrade against a manually started supervisor as well.
        with (STATE/'run.lock').open('a') as run_lock:
            fcntl.flock(run_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            step('Micromamba',lambda:download_runtime('micromamba'))
            step('Standalone Conda',lambda:download_runtime('conda'))
            step('Private dependencies',install_environment)
            step('Node',lambda:download_runtime('node'))
            settings=configure(args);env=runtime_env(settings)
            step('Application snapshot',snapshot)
            private_write(STATE/'profile',args.profile)
            step('Application packages',lambda:command(['npm','ci'],cwd=APP,env=env))
            step('Build',lambda:command(['npm','run','build'],cwd=APP,env=env))
            step('Database backup and migration',lambda:database(settings,lambda:command(['npm','run','db:migrate'],cwd=APP,env=env)))
            if args.profile!='app': step('Ollama',lambda:download_runtime('ollama'))
            import shlex
            private_write(STATE/'bin/vani','#!/bin/sh\nexec '+shlex.quote(sys.executable)+' '+shlex.quote(str(APP/'scripts/setup/control.py'))+' "$@"\n');(STATE/'bin/vani').chmod(0o700)
        step('Start VANI',lambda:command([STATE/'bin/vani','start']))
        if args.profile!='app' and not args.skip_models:
            model_env=env.copy();model_env['OLLAMA_HOST']=settings['OLLAMA_BASE_URL']
            for model in [settings['OLLAMA_MODEL'],settings['OLLAMA_EMBED_MODEL']]:
                step('Pull '+model,lambda model=model:command([STATE/'runtime/ollama/bin/ollama','pull',model],env=model_env))
        final=report(args);private_write(STATE/'health.json',json.dumps(final,indent=2))
        private_write(STATE/'installed-versions.json',json.dumps({'manifest':MANIFEST,'models':final['models']},indent=2))
        print_report(final,args.json)
        print('VANI: http://127.0.0.1:3000 · Control: ~/vani/bin/vani start|stop|status · Logs: ~/vani/logs')
        return 0 if final['ready'] else 2


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);m=p.add_mutually_exclusive_group()
    for name in ('check','dry-run','install'): m.add_argument('--'+name,action='store_true')
    p.add_argument('--profile',choices=['app','local-5090','local-small'],default='local-5090')
    for name in ('check-network','resume','json','yes','skip-models'): p.add_argument('--'+name,action='store_true')
    args=p.parse_args(argv)
    if not any((args.check,args.dry_run,args.install)): p.print_help();return 0
    if (args.resume or args.skip_models or args.yes) and not args.install: p.error('Installation modifiers require --install')
    try:
        if args.install: return install(args)
        result=report(args)
        if args.dry_run: result['plan']=plan(args)
        print_report(result,args.json)
        return 3 if not result['supported'] else 0 if result['ready'] else 2
    except Exception as e: print('Setup failed: '+str(e),file=sys.stderr);return 1
if __name__=='__main__': sys.exit(main())
