#!/usr/bin/env python3
"""Control a dedicated VANI debugging workspace over SSH. No remote HTTP shell."""
import argparse, json, pathlib, re, shlex, subprocess, sys, tarfile, tempfile, uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]

def remote_command(ssh, host, argv, **kwargs):
    # Login shells may print banners or ssh-agent output before our command.
    # Frame stdout so both JSON responses and binary report archives stay intact.
    marker=('VANI_DEBUG_OUTPUT_'+uuid.uuid4().hex+'\n').encode()
    command='printf %s '+shlex.quote(marker.decode())+'; exec '+shlex.join([str(x) for x in argv])
    capture=kwargs.pop('capture_output',False);destination=kwargs.pop('stdout',None)
    as_text=kwargs.pop('text',False)
    try:
        result=subprocess.run(ssh+[host,command],check=True,stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE if capture else None,**kwargs)
    except subprocess.CalledProcessError as error:
        detail=error.stderr.decode(errors='replace')[-2000:] if error.stderr else 'See SSH stderr above.'
        raise RuntimeError(f'SSH debug command failed ({error.returncode}): {detail}') from None
    if marker not in result.stdout:raise RuntimeError('Remote debug response framing missing.')
    result.stdout=result.stdout.split(marker,1)[1]
    if as_text:
        result.stdout=result.stdout.decode()
        if result.stderr is not None:result.stderr=result.stderr.decode()
    if not capture:
        if destination is not None:destination.write(result.stdout)
        elif as_text:sys.stdout.write(result.stdout)
        else:sys.stdout.buffer.write(result.stdout)
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['deploy','run','status','logs','cancel','recover','fetch','tunnel'])
    p.add_argument('--address-family',choices=['auto','4','6'],default='auto');p.add_argument('--host',default='kdantu@quasar.cse.buffalo.edu');p.add_argument('--ssh-port',type=int,default=22);p.add_argument('--identity')
    p.add_argument('--root',default='/data/install/vani-debug');p.add_argument('--install',default='/data/install/vani');p.add_argument('--python',default='python3')
    p.add_argument('--job',choices=['doctor','snapshot','regression','model-smoke','browser','lab','soak','replay'],default='doctor');p.add_argument('--id');p.add_argument('--maintenance',action='store_true');p.add_argument('--duration',type=int,default=3600);p.add_argument('--revision',default='HEAD');p.add_argument('--output',default='.vani-diagnostics/quasar');p.add_argument('--local-port',type=int,default=3001)
    a=p.parse_args()
    if not a.host or a.host.startswith('-') or any(c.isspace() for c in a.host):p.error('Invalid SSH host.')
    if not 1<=a.ssh_port<=65535 or not 1024<=a.local_port<=65535:p.error('Invalid port.')
    for path in (a.root,a.install):
        if not pathlib.PurePosixPath(path).is_absolute() or any(c in path for c in '\n\r\0'):p.error('Use absolute remote paths.')
    ssh=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-p',str(a.ssh_port)]
    if a.address_family!='auto':ssh+=['-'+a.address_family]
    if a.identity:ssh+=['-i',a.identity,'-o','IdentitiesOnly=yes']
    def remote(argv,**kwargs):
        argv=list(argv)
        if argv[0]==a.python:argv.insert(1,'-I')
        return remote_command(ssh,a.host,argv,**kwargs)
    if a.action=='tunnel':
        subprocess.run(ssh+['-o','ExitOnForwardFailure=yes','-N','-L',f'127.0.0.1:{a.local_port}:127.0.0.1:18082',a.host],check=True);return
    if a.action=='deploy':
        commit=subprocess.check_output(['git','rev-parse','--verify',a.revision+'^{commit}'],cwd=ROOT,text=True).strip()
        if not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('Invalid Git revision.')
        archive=subprocess.check_output(['git','archive','--format=tar',commit],cwd=ROOT)
        bootstrap=(ROOT/'scripts/debug/bootstrap.py').read_text()
        remote([a.python,'-c',bootstrap,a.root,a.install,commit],input=archive);return
    metadata=json.loads(remote([a.python,'-c','import json,sys; print(open(sys.argv[1]).read())',a.root+'/release.json'],capture_output=True,text=True).stdout)
    if metadata.get('install')!=a.install:raise ValueError('Installation root differs from deployed configuration.')
    commit=metadata.get('commit','')
    if not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('Invalid deployed revision.')
    runner=[a.python,f'{a.root}/releases/{commit}/scripts/debug/runner.py']
    args=['--root',a.root,'--install',a.install]
    if a.id:args+=['--id',a.id]
    if a.action=='fetch':
        manifest=json.loads(remote(runner+['status']+args,capture_output=True,text=True).stdout);job_id=manifest['id']
        if not re.fullmatch(r'[0-9a-f]{32}',job_id):raise ValueError('Invalid remote job ID.')
        if manifest['state'] in ('queued','running'):raise ValueError('Wait for the job to finish, or use logs while it runs.')
        destination=pathlib.Path(a.output).resolve()/job_id
        if destination.exists():raise ValueError('Report destination already exists; choose another --output.')
        destination.mkdir(parents=True,mode=0o700)
        # Export reports only: no database cluster, PDF objects, or password files.
        script="""import pathlib,sys,tarfile
root=pathlib.Path(sys.argv[1]);archive=tarfile.open(fileobj=sys.stdout.buffer,mode='w|')
for path in root.rglob('*'):
 relative=path.relative_to(root)
 if path.is_file() and not path.is_symlink() and path.suffix in ('.json','.jsonl','.log','.md','.xml','.png') and relative.parts[0] not in ('postgres','objects') and 'password' not in path.name:archive.add(path,arcname=str(relative),recursive=False)
archive.close()
"""
        with tempfile.TemporaryFile() as stream:
            remote([a.python,'-c',script,f'{a.root}/runs/{job_id}'],stdout=stream);stream.seek(0)
            with tarfile.open(fileobj=stream) as archive:
                for member in archive:
                    path=pathlib.PurePosixPath(member.name)
                    if path.is_absolute() or '..' in path.parts or not member.isfile():raise ValueError('Unsafe report archive.')
                    target=destination/member.name;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                    with archive.extractfile(member) as src,target.open('wb') as out:
                        import shutil
                        shutil.copyfileobj(src,out)
                    target.chmod(0o600)
        print(destination);return
    if a.action=='run':
        args+=['--job',a.job,'--duration',str(a.duration)]
        if a.maintenance:args+=['--maintenance']
    remote(runner+[a.action]+args)
if __name__=='__main__':
    try:main()
    except (Exception,KeyboardInterrupt) as e:print(str(e),file=sys.stderr);sys.exit(1)
