#!/usr/bin/env python3
"""Receive a committed source archive on stdin and atomically deploy a debug release."""
import fcntl, hashlib, io, json, os, pathlib, re, shutil, sys, tarfile, tempfile

def deploy(root,install,commit,payload):
    root=pathlib.Path(root).absolute();install=pathlib.Path(install).absolute()
    if not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('Expected a full Git commit.')
    if root.resolve()!=root or install.resolve()!=install or root==install or root in install.parents or install in root.parents or root in (pathlib.Path('/'),pathlib.Path.home()):raise ValueError('Debug root must be a dedicated canonical directory outside production.')
    if root.exists() and not (root/'.vani-debug-owned').is_file():raise ValueError('Refusing an unmarked debug directory.')
    os.umask(0o077);root.mkdir(parents=True,exist_ok=True);(root/'.vani-debug-owned').touch()
    for name in ('runs','releases','runtime','tmp'):
        if (root/name).is_symlink():raise ValueError('Managed path must not be a symlink.')
        (root/name).mkdir(exist_ok=True)
    with (root/'job.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if (root/'maintenance.json').exists() and json.loads((root/'maintenance.json').read_text()).get('active'):raise ValueError('Recover unfinished maintenance before deployment.')
        destination=root/'releases'/commit
        if not destination.exists():
            with tempfile.TemporaryDirectory(dir=root/'tmp',prefix='deploy-') as temporary:
                staging=pathlib.Path(temporary)/'source';staging.mkdir()
                with tarfile.open(fileobj=io.BytesIO(payload),mode='r:') as archive:
                    members=archive.getmembers()
                    if sum(m.size for m in members)>500*1024**2:raise ValueError('Archive too large.')
                    for member in members:
                        path=pathlib.PurePosixPath(member.name)
                        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):raise ValueError('Unsafe source archive entry.')
                    for member in members:
                        target=staging/member.name
                        if member.isdir():target.mkdir(parents=True,exist_ok=True)
                        else:
                            target.parent.mkdir(parents=True,exist_ok=True)
                            with archive.extractfile(member) as src,target.open('wb') as out:shutil.copyfileobj(src,out)
                            target.chmod(0o700 if member.mode&0o111 else 0o600)
                if not (staging/'scripts/debug/runner.py').is_file():raise ValueError('This commit lacks the debug runner.')
                inputs={str(path.relative_to(staging)):hashlib.sha256(path.read_bytes()).hexdigest() for path in staging.rglob('*') if path.is_file()}
                (staging/'.debug-inputs.json').write_text(json.dumps(inputs))
                (staging/'.debug-revision').write_text(commit)
                staging.rename(destination)
        metadata={'commit':commit,'archiveSha256':hashlib.sha256(payload).hexdigest(),'install':str(install)}
        temporary=root/'release.tmp';temporary.write_text(json.dumps(metadata));temporary.replace(root/'release.json')
        return metadata
if __name__=='__main__':
    try:
        data=sys.stdin.buffer.read(500*1024**2+1)
        if len(data)>500*1024**2:raise ValueError('Archive too large.')
        print(json.dumps(deploy(*sys.argv[1:],data)))
    except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
