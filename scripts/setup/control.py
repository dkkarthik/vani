#!/usr/bin/env python3
"""Control only the verified VANI home supervisor process."""
import fcntl, os, pathlib, signal, subprocess, sys, time
from ubuntu import APP, STATE, runtime_env


def running_pid():
    try:
        pid=int((STATE/'run.pid').read_text())
        if pid<=1: return None
        # PID reuse must never cause us to signal an unrelated process.
        proc=pathlib.Path('/proc')/str(pid)
        if proc.stat().st_uid!=os.getuid(): return None
        argv=(proc/'cmdline').read_bytes().split(b'\0')
        if str(APP/'scripts/setup/launch.py').encode() not in argv: return None
        os.kill(pid,0);return pid
    except (OSError,ValueError): return None


def main(argv=None):
    argv=argv if argv is not None else sys.argv[1:]
    if argv not in (['start'],['stop'],['status']): print(f'Usage: {STATE}/bin/vani start|stop|status');return 2
    action=argv[0];pid=running_pid()
    if action=='status':
        ready=pid and (STATE/'run.ready').exists()
        print('VANI '+('running' if ready else 'starting' if pid else 'stopped'));return 0 if ready else 1
    if action=='stop':
        if not pid: print('VANI is stopped.');return 0
        os.kill(pid,signal.SIGTERM)
        for _ in range(300):
            if running_pid()!=pid: print('VANI stopped.');return 0
            time.sleep(.5)
        raise RuntimeError(f'Shutdown timed out; inspect {STATE}/logs before restarting.')
    if pid:
        print('VANI is already running or starting.');return 0 if (STATE/'run.ready').exists() else 2
    # Readiness file from a crashed process cannot certify a new process.
    with (STATE/'run.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        (STATE/'run.ready').unlink(missing_ok=True)
    with (STATE/'logs/supervisor.log').open('ab') as log:
        child=subprocess.Popen([sys.executable,str(APP/'scripts/setup/launch.py')],cwd=APP,env=runtime_env(),stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    for _ in range(360):
        if child.poll() is not None: raise RuntimeError(f'Startup failed; inspect {STATE}/logs/supervisor.log and service logs.')
        if (STATE/'run.ready').exists() and (STATE/'run.ready').read_text()==str(child.pid): print('VANI running: http://127.0.0.1:3000');return 0
        time.sleep(.5)
    child.terminate()
    raise RuntimeError(f'Startup timed out; requested shutdown. Inspect {STATE}/logs.')

if __name__=='__main__':
    try: sys.exit(main())
    except Exception as e: print(str(e),file=sys.stderr);sys.exit(1)
