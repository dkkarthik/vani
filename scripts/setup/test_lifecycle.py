"""Exercise supervisor teardown with real child processes and fixture readiness probes."""
import importlib.util, os, pathlib, signal, subprocess, sys, tempfile, time, unittest

class LifecycleTests(unittest.TestCase):
 def run_supervisor(self, crash=False):
  source=pathlib.Path(__file__).resolve().parent
  with tempfile.TemporaryDirectory(prefix='vani lifecycle ') as directory:
   base=pathlib.Path(directory)
   for name in ('app','logs','runtime/deps/bin','runtime/node/bin','postgres'): (base/name).mkdir(parents=True,exist_ok=True)
   (base/'profile').write_text('app');(base/'postgres/.vani-owned').touch()
   stub='#!'+sys.executable+'\nimport os,time,pathlib\npathlib.Path(os.environ["PID_FOLDER"], str(os.getpid())).touch()\ntime.sleep(60)\n'
   for path in ('runtime/deps/bin/postgres','runtime/node/bin/node'):
    target=base/path;target.write_text(stub);target.chmod(0o700)
   psql=base/'runtime/deps/bin/psql';psql.write_text('#!'+sys.executable+'\n');psql.chmod(0o700)
   pids=base/'children';pids.mkdir()
   runner=base/'runner.py'
   runner.write_text('''import sys,pathlib,contextlib
from unittest.mock import patch,MagicMock
sys.path.insert(0,sys.argv[1])
import launch
base=pathlib.Path(sys.argv[2])
launch.STATE=base;launch.APP=base/'app';launch.PREFIX=base/'runtime/deps'
launch.env_data=lambda _: {'DATABASE_URL':'postgres://fixture','VANI_API_PORT':'8080'}
launch.validate_settings=lambda _: None
launch.postgres_env=lambda _: dict(__import__('os').environ)
launch.runtime_env=lambda _: dict(__import__('os').environ,PID_FOLDER=str(base/'children'))
launch.read_url=lambda _: {}
with patch.object(launch.socket,'socket'),patch('urllib.request.urlopen') as response:
 response.return_value.__enter__.return_value.status=200
 sys.exit(launch.main())
''')
   log=(base/'test.log').open('w')
   proc=subprocess.Popen([sys.executable,str(runner),str(source),str(base)],stdout=log,stderr=log)
   try:
    deadline=time.monotonic()+10
    while not (base/'run.ready').exists() and proc.poll() is None and time.monotonic()<deadline: time.sleep(.05)
    self.assertTrue((base/'run.ready').exists(),(base/'test.log').read_text())
    while len(list(pids.iterdir()))<3 and time.monotonic()<deadline:time.sleep(.05)
    ids=[int(p.name) for p in pids.iterdir()];self.assertEqual(len(ids),3)
    if crash: os.kill(ids[-1],signal.SIGKILL)
    else: proc.terminate()
    proc.wait(timeout=10)
    self.assertEqual(proc.returncode,1 if crash else 0)
    self.assertFalse((base/'run.pid').exists());self.assertFalse((base/'run.ready').exists())
    for pid in ids:
     with self.assertRaises(ProcessLookupError): os.kill(pid,0)
   finally:
    if proc.poll() is None: proc.kill();proc.wait()
    log.close()
 def test_stop_reaps_all_children(self):self.run_supervisor()
 def test_child_failure_stops_siblings(self):self.run_supervisor(crash=True)

if __name__=='__main__':unittest.main()
