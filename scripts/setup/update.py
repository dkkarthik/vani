#!/usr/bin/env python3
"""Managed, commit-pinned updates. Never modifies the developer's checkout."""
import argparse, datetime, fcntl, hashlib, json, os, pathlib, re, shutil, subprocess, sys, tarfile, tempfile, time, urllib.request

REPOSITORY = 'https://github.com/dkkarthik/vani'
API = 'https://api.github.com/repos/dkkarthik/vani/commits/main'
SHA = re.compile(r'^[0-9a-f]{40}$')
BUSY = ('queued', 'downloading', 'installing')


def read(path, default=None):
    try: return json.loads(path.read_text())
    except (OSError, ValueError): return default


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    temp.write_text(json.dumps(value)); temp.chmod(0o600); temp.replace(path)


def source_digest(root):
    digest = hashlib.sha256()
    paths=[]
    for directory, dirs, files in os.walk(root):
        dirs[:]=sorted(d for d in dirs if d not in ('node_modules','dist','__pycache__','.git'))
        paths.extend(pathlib.Path(directory)/name for name in files)
    for path in sorted(paths):
        relative = path.relative_to(root)
        if any(p in ('node_modules', 'dist', '__pycache__', '.git') for p in relative.parts): continue
        if not path.is_file() or path.name.endswith(('.pyc', '.tsbuildinfo')): continue
        if relative.parts[0] not in ('apps', 'packages', 'scripts') and not (len(relative.parts)==1 and (path.suffix in ('.json', '.js', '.mjs') or path.name=='.npmrc')): continue
        if path.name == 'build-identity.json': continue
        digest.update(str(relative).encode()); digest.update(b'\0'); digest.update(path.read_bytes())
    return digest.hexdigest()


def record_identity(source, destination):
    inherited = read(source/'build-identity.json', {})
    commit = inherited.get('commit')
    dirty = inherited.get('dirty', False)
    try:
        top = subprocess.check_output(['git','-C',str(source),'rev-parse','--show-toplevel'],text=True,stderr=subprocess.DEVNULL).strip()
        if pathlib.Path(top).resolve() == source.resolve():
            commit = subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
            dirty = bool(subprocess.check_output(['git','-C',str(source),'status','--porcelain'],text=True).strip())
    except (OSError, subprocess.SubprocessError): pass
    write(destination/'build-identity.json', {'commit':commit, 'dirty':dirty, 'repository':REPOSITORY, 'digest':source_digest(destination)})


def managed(root):
    if root.is_symlink() or not (root/'app/.vani-owned').is_file() or not (root/'profile').is_file():
        raise ValueError('UI updates require a managed Ubuntu installation.')
    for name in ('app', 'updates', 'logs'):
        if (root/name).is_symlink(): raise ValueError('Managed update paths must not be symlinks.')
    identity = read(root/'app/build-identity.json', {})
    return identity


def lock(root):
    (root/'updates').mkdir(exist_ok=True, mode=0o700)
    handle = (root/'updates/worker.lock').open('a')
    try: fcntl.flock(handle, fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: handle.close(); return None
    return handle


def status(root):
    identity = managed(root)
    job = read(root/'updates/status.json', {})
    if job.get('state') in BUSY:
        handle = lock(root)
        if handle:
            handle.close()
            job = {**job, 'state':'failed', 'message':'Update interrupted. Inspect logs/update.log and rerun the installer.'}
    latest = read(root/'updates/latest.json', {})
    supported = bool(SHA.fullmatch(identity.get('commit') or '') and not identity.get('dirty'))
    return {'supported':supported, 'installed':identity.get('commit'), 'latest':latest.get('commit'),
            'available':bool(supported and not latest.get('error') and latest.get('commit') and latest['commit']!=identity.get('commit')),
            'checkedAt':latest.get('checkedAt'), 'checkError':latest.get('error'), 'job':job,
            'reason':None if supported else 'Run one terminal upgrade from a clean Git checkout to enable UI updates.',
            'installRoot':str(root), 'repository':REPOSITORY}


def check(root, force=False):
    managed(root)
    cache = read(root/'updates/latest.json', {})
    age = time.time() - cache.get('timestamp', 0)
    if not force and age < (300 if cache.get('error') else 7200): return status(root)
    handle_path = root/'updates/check.lock'
    handle_path.parent.mkdir(exist_ok=True, mode=0o700)
    with handle_path.open('a') as handle:
        try: fcntl.flock(handle, fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: return status(root)
        result = {**cache, 'timestamp':time.time(), 'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        try:
            request = urllib.request.Request(API, headers={'User-Agent':'VANI-updater','Accept':'application/vnd.github+json'})
            with urllib.request.urlopen(request, timeout=15) as response: commit=json.load(response)['sha']
            if not SHA.fullmatch(commit): raise ValueError('Invalid GitHub commit response.')
            result.update(commit=commit, error=None)
        except Exception:
            result['error']='Could not check GitHub. Check connectivity or try again later (GitHub may rate-limit requests).'
        write(root/'updates/latest.json', result)
    return status(root)


def start(root, commit):
    identity=managed(root)
    if not SHA.fullmatch(commit): raise ValueError('Invalid update commit.')
    if identity.get('dirty') or not SHA.fullmatch(identity.get('commit') or ''): raise ValueError('Updates require a clean, identified installation.')
    latest=read(root/'updates/latest.json', {})
    if latest.get('error') or commit != latest.get('commit'): raise ValueError('Check for updates again before installing.')
    handle=lock(root)
    if not handle: return status(root)
    try:
        if source_digest(root/'app') != identity.get('digest'): raise ValueError('Managed application sources were edited. Preserve those changes and update from your source checkout instead.')
        if commit==identity['commit']: return status(root)
        worker=root/'updates/worker.py'
        shutil.copy2(__file__, worker)
        write(root/'updates/status.json', {'state':'queued','target':commit,'startedAt':time.time()})
        with (root/'logs/update.log').open('ab') as log:
            subprocess.Popen([sys.executable,str(worker),'run','--root',str(root),'--commit',commit,'--lock-fd',str(handle.fileno())],
                stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True,pass_fds=(handle.fileno(),),cwd=root)
    except Exception:
        write(root/'updates/status.json', {'state':'failed','message':'Could not start update. Check logs/update.log or preserve local edits before retrying.'})
        raise
    finally: handle.close()
    return status(root)


def unpack(archive, destination):
    with tarfile.open(archive, 'r:gz') as bundle:
        members=bundle.getmembers()
        if sum(m.size for m in members)>1024**3: raise ValueError('Update archive is too large.')
        for member in members:
            parts=pathlib.PurePosixPath(member.name)
            if parts.is_absolute() or '..' in parts.parts or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe update archive entry.')
        for member in members:
            target=destination/member.name
            if member.isdir(): target.mkdir(parents=True,exist_ok=True)
            else:
                target.parent.mkdir(parents=True,exist_ok=True)
                with bundle.extractfile(member) as src, target.open('wb') as dst: shutil.copyfileobj(src,dst)
                target.chmod(0o700 if member.mode & 0o111 else 0o600)
    roots=list(destination.iterdir())
    if len(roots)!=1 or not (roots[0]/'scripts/setup-ubuntu.sh').is_file(): raise ValueError('Invalid VANI source archive.')
    return roots[0]


def run(root, commit, lock_fd):
    # The inherited descriptor keeps the start lock held across API shutdown.
    if lock_fd is None: raise ValueError('Updates must be started through the locked start command.')
    os.fstat(lock_fd)
    job=read(root/'updates/status.json', {})
    def progress(state, message):
        write(root/'updates/status.json', {**job,'target':commit,'state':state,'message':message,'updatedAt':time.time()})
    try:
        progress('downloading','Downloading the selected GitHub commit.')
        with tempfile.TemporaryDirectory(prefix='source-',dir=root/'updates') as temporary:
            base=pathlib.Path(temporary); archive=base/'source.tar.gz'; destination=base/'source';destination.mkdir()
            request=urllib.request.Request(f'https://codeload.github.com/dkkarthik/vani/tar.gz/{commit}', headers={'User-Agent':'VANI-updater'})
            with urllib.request.urlopen(request,timeout=60) as response, archive.open('wb') as output:
                total=0
                while chunk:=response.read(1024*1024):
                    total+=len(chunk)
                    if total>200*1024**2: raise ValueError('Update download is too large.')
                    output.write(chunk)
            source=unpack(archive,destination)
            write(source/'build-identity.json',{'commit':commit,'dirty':False,'repository':REPOSITORY})
            profile=(root/'profile').read_text().strip()
            if profile not in ('app','local-small','local-5090'): raise ValueError('Unknown installed profile.')
            identity=managed(root)
            if identity.get('dirty') or source_digest(root/'app') != identity.get('digest'):
                raise ValueError('Managed sources changed during download. Preserve edits before updating.')
            progress('installing','Installing, backing up the database, migrating and restarting. The UI may temporarily disconnect.')
            subprocess.run(['bash',str(source/'scripts/setup-ubuntu.sh'),'--install','--yes','--skip-models','--profile',profile,'--install-dir',str(root)],check=True,cwd=source)
        if read(root/'app/build-identity.json',{}).get('commit')!=commit: raise RuntimeError('Installed revision did not match the requested commit.')
        progress('complete','Update installed. Reload VANI to use the new UI.')
    except Exception as error:
        print(str(error),file=sys.stderr,flush=True)
        progress('failed','Update failed. Inspect logs/update.log. If VANI is offline, rerun the installer from your source checkout using the same installation path.')
        return 1
    finally: os.close(lock_fd)
    return 0


def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['status','check','start','run']);parser.add_argument('--root',required=True);parser.add_argument('--commit',default='');parser.add_argument('--force',action='store_true');parser.add_argument('--lock-fd',type=int)
    args=parser.parse_args();root=pathlib.Path(args.root).absolute()
    if args.action=='run': return run(root,args.commit,args.lock_fd)
    result=check(root,args.force) if args.action=='check' else start(root,args.commit) if args.action=='start' else status(root)
    print(json.dumps(result));return 0

if __name__=='__main__':
    try: sys.exit(main())
    except Exception as error: print(str(error),file=sys.stderr);sys.exit(1)
