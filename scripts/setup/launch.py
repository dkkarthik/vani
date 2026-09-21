#!/usr/bin/env python3
"""Supervise the home installation; no system service manager required."""
import fcntl, os, secrets, signal, socket, subprocess, sys, time
from ubuntu import APP, STATE, CONFIG, PREFIX, env_data, runtime_env, postgres_env, validate_settings, read_url, private_write


def main():
    settings=env_data(CONFIG);validate_settings(settings)
    env=runtime_env(settings)
    env.update({'VANI_INSTALL_ROOT':str(STATE),'VANI_UPDATE_PYTHON':sys.executable,'VANI_WEB_PROXY_TOKEN':secrets.token_urlsafe(32)})
    children=[];logs=[];stopping=False
    def stop(*_):
        nonlocal stopping
        stopping=True
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    def spawn(name,argv):
        log=(STATE/'logs'/f'{name}.log').open('ab');logs.append(log)
        child=subprocess.Popen([str(a) for a in argv],cwd=APP,env=env,stdout=log,stderr=subprocess.STDOUT)
        children.append(child);return child
    def wait_until(check, seconds=60):
        for _ in range(seconds*2):
            if stopping or any(p.poll() is not None for p in children): raise RuntimeError(f'A VANI process exited during startup; inspect {STATE}/logs.')
            try:
                if check(): return
            except Exception: pass
            time.sleep(.5)
        raise RuntimeError(f'Service readiness timeout; inspect {STATE}/logs.')
    with (STATE/'run.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        profile=(STATE/'profile').read_text().strip()
        ports=[55432,int(settings['VANI_API_PORT']),3000]+([11435] if profile!='app' else [])
        for port in ports:
            with socket.socket() as probe: probe.bind(('127.0.0.1',port))
        if not (STATE/'postgres/.vani-owned').exists(): raise RuntimeError('Managed PostgreSQL cluster is missing.')
        private_write(STATE/'run.pid',str(os.getpid()))
        (STATE/'run.ready').unlink(missing_ok=True)
        try:
            spawn('postgres',[PREFIX/'bin/postgres','-D',STATE/'postgres','-h','127.0.0.1','-p','55432','-k',''])
            pg_env=postgres_env(settings)
            wait_until(lambda:subprocess.run([str(PREFIX/'bin/psql'),'-X','-Atc','SELECT 1'],env=pg_env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3).returncode==0)
            if profile!='app':
                env.update({'OLLAMA_HOST':'127.0.0.1:11435','OLLAMA_NO_CLOUD':'1','OLLAMA_NUM_PARALLEL':'1','OLLAMA_MAX_LOADED_MODELS':'1'})
                spawn('ollama',[STATE/'runtime/ollama/bin/ollama','serve'])
                wait_until(lambda:read_url('http://127.0.0.1:11435/api/tags') is not None)
            spawn('api',[STATE/'runtime/node/bin/node','apps/api/dist/index.js'])
            spawn('web',[STATE/'runtime/node/bin/node','scripts/serve-local.mjs'])
            wait_until(lambda:read_url('http://127.0.0.1:'+settings['VANI_API_PORT']+'/api/v1/health') is not None)
            import urllib.request
            def web_ready():
                with urllib.request.urlopen('http://127.0.0.1:3000',timeout=3) as response: return response.status==200
            wait_until(web_ready)
            private_write(STATE/'run.ready',str(os.getpid()))
            while not stopping:
                if any(p.poll() is not None for p in children): raise RuntimeError('A VANI process exited; stopping the remaining services.')
                time.sleep(.5)
        finally:
            # Application first, database last. SIGINT requests PostgreSQL fast shutdown.
            for child in reversed(children):
                if child.poll() is None:
                    child.send_signal(signal.SIGINT if child is children[0] else signal.SIGTERM)
                    try: child.wait(timeout=30)
                    except subprocess.TimeoutExpired: child.kill();child.wait()
            for log in logs: log.close()
            (STATE/'run.ready').unlink(missing_ok=True);(STATE/'run.pid').unlink(missing_ok=True)
    return 0

if __name__=='__main__':
    try: sys.exit(main())
    except Exception as e: print(str(e),file=sys.stderr);sys.exit(1)
