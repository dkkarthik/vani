import importlib.util, hashlib, io, json, os, pathlib, signal, subprocess, sys, tarfile, tempfile, time, unittest
from unittest.mock import patch
import runner, bootstrap

class DebugTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='vani debug test ');self.base=pathlib.Path(self.temp.name).resolve();self.root=self.base/'debug';self.install=self.base/'prod';self.root.mkdir();(self.root/'.vani-debug-owned').touch()
  runner.roots(self.root,self.install)
  self.commit='a'*40;self.source=self.root/'releases'/self.commit;(self.source/'scripts/debug').mkdir(parents=True)
  (self.source/'scripts/debug/runner.py').write_text(pathlib.Path(runner.__file__).read_text())
  runner.write(self.source/'.debug-inputs.json',{'scripts/debug/runner.py':hashlib.sha256((self.source/'scripts/debug/runner.py').read_bytes()).hexdigest()})
  runner.write(self.root/'release.json',{'commit':self.commit,'install':str(self.install)})
  (self.install/'app').mkdir(parents=True);(self.install/'app/.vani-owned').touch()
  tools=self.install/'runtime/deps/bin';tools.mkdir(parents=True)
  for name in ('node','npm','pg_ctl','postgres','initdb','createdb','psql','pdftotext','nvidia-smi'):
   path=tools/name;path.write_text('#!/bin/sh\necho fixture-runtime\n');path.chmod(0o700)
 def tearDown(self):
  for child in runner._detached_children:
   if child.poll() is None: child.terminate()
   child.wait(timeout=15)
  runner._detached_children.clear()
  self.temp.cleanup()
 def job(self):
  job_id='1'*32;folder=self.root/'runs'/job_id;folder.mkdir(exist_ok=True)
  runner.write(folder/'manifest.json',{'id':job_id,'job':'doctor','state':'queued','createdAt':time.time(),'runner':str(self.source/'scripts/debug/runner.py'),'source':str(self.source),'maintenance':True,'duration':1})
  return runner.Job(self.root,self.install,job_id)
 def test_roots_reject_overlap_and_unowned_directory(self):
  with self.assertRaises(ValueError):runner.roots(self.install,self.install)
  with self.assertRaises(ValueError):runner.roots(self.install/'child',self.install)
  with self.assertRaises(ValueError):runner.roots(self.base/'other',self.install)
 def test_environment_does_not_inherit_production_credentials_or_injected_node_options(self):
  with patch.dict(os.environ,{'DATABASE_URL':'production','OPENAI_API_KEY':'secret','VANI_INSTALL_ROOT':'production','NODE_OPTIONS':'malicious','PYTHONPATH':'bad'}):
   env=runner.environment(self.root,self.install)
   for key in ('DATABASE_URL','OPENAI_API_KEY','VANI_INSTALL_ROOT','NODE_OPTIONS','PYTHONPATH'):self.assertNotIn(key,env)
   self.assertEqual(env['VANI_CLOUD_MODE'],'off')
 def test_job_lock_serializes_work(self):
  with runner.acquire(self.root):
   with self.assertRaises(RuntimeError):runner.acquire(self.root)
 def test_gpu_requires_explicit_maintenance_and_valid_duration(self):
  with self.assertRaises(ValueError):runner.start(self.root,self.install,'lab',10,False)
  with self.assertRaises(ValueError):runner.start(self.root,self.install,'doctor',999999,False)
 def test_cancel_identity_does_not_match_our_test_process(self):
  self.assertFalse(runner.process_matches(os.getpid(),'/missing/runner.py','1'*32))
 def test_missing_worker_becomes_interrupted(self):
  job=self.job();job.save(createdAt=0,pid=99999999);job.log.close()
  self.assertEqual(runner.status(self.root,job.id)['state'],'interrupted')
 def test_maintenance_restores_after_failure(self):
  job=self.job();calls=[]
  job.step=lambda name,argv,*a,**kw:calls.append([str(x) for x in argv])
  try:
   with patch.object(runner.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'VANI running','')):
    with self.assertRaisesRegex(ValueError,'fixture'):
     with job.maintenance():raise ValueError('fixture')
   self.assertEqual([c[-1] for c in calls],['stop','start'])
   self.assertFalse(runner.read(self.root/'maintenance.json')['active'])
  finally:job.log.close()
 def test_restore_retries_old_launcher_port_conflict(self):
  job=self.job();(self.install/'logs').mkdir();(self.install/'logs/supervisor.log').write_text('[Errno 98] Address already in use')
  try:
   with patch.object(job,'step',side_effect=[RuntimeError('startup'),None]) as step,patch.object(runner.time,'sleep') as sleep:
    job.restore_production()
   self.assertEqual(step.call_count,2);sleep.assert_called_once_with(35)
   self.assertNotIn('OLLAMA_BASE_URL',step.call_args.args[3])
  finally:job.log.close()
 def test_maintenance_leaves_previously_stopped_production_stopped(self):
  job=self.job();calls=[];job.step=lambda *a,**kw:calls.append(a)
  try:
   with patch.object(runner.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'VANI stopped','')):
    with job.maintenance():pass
   self.assertEqual(calls,[])
  finally:job.log.close()
 def test_timeout_reaps_child_and_redacts_output(self):
  log=io.StringIO();record=self.root/'step.json'
  with self.assertRaises(TimeoutError):runner.private_command([sys.executable,'-I','-c','import time;print("secret-token",flush=True);time.sleep(60)'],runner.environment(self.root,self.install),self.root,log,.3,('secret-token',),record)
  self.assertNotIn('secret-token',log.getvalue());self.assertIn('[REDACTED]',log.getvalue());self.assertFalse(record.exists())
 def test_real_detached_doctor_job_retains_manifest_and_log(self):
  result=runner.start(self.root,self.install,'doctor',60,False)
  deadline=time.monotonic()+10
  while time.monotonic()<deadline:
   status=runner.status(self.root,result['id'])
   if status['state'] not in ('queued','running'):break
   time.sleep(.05)
  self.assertEqual(status['state'],'passed',status)
  self.assertEqual(status['commit'],self.commit)
  self.assertEqual(len(status['completedSteps']),3)
  self.assertIn('fixture-runtime',(self.root/'runs'/result['id']/'job.log').read_text())
 def test_bootstrap_rejects_traversal(self):
  output=io.BytesIO()
  with tarfile.open(fileobj=output,mode='w') as archive:
   entry=tarfile.TarInfo('../escape');entry.size=1;archive.addfile(entry,io.BytesIO(b'x'))
  with self.assertRaises(ValueError):bootstrap.deploy(self.base/'fresh',self.install,'b'*40,output.getvalue())
 def test_bootstrap_rejects_unmarked_directory(self):
  folder=self.base/'unmarked';folder.mkdir()
  with self.assertRaises(ValueError):bootstrap.deploy(folder,self.install,'b'*40,b'')
 def test_bootstrap_installs_only_safe_revision(self):
  output=io.BytesIO()
  with tarfile.open(fileobj=output,mode='w') as archive:
   entry=tarfile.TarInfo('scripts/debug/runner.py');entry.size=4;archive.addfile(entry,io.BytesIO(b'pass'))
  result=bootstrap.deploy(self.base/'fresh',self.install,'b'*40,output.getvalue())
  self.assertEqual(result['commit'],'b'*40)
  self.assertTrue((self.base/'fresh/releases'/('b'*40)/'scripts/debug/runner.py').is_file())

class CancellationTests(unittest.TestCase):
 setUp=DebugTests.setUp
 tearDown=DebugTests.tearDown
 job=DebugTests.job
 def test_real_job_cancellation_stops_the_step(self):
  command=self.install/'runtime/deps/bin/nvidia-smi'
  command.write_text('#!/bin/sh\nsleep 60\n');command.chmod(0o700)
  result=runner.start(self.root,self.install,'doctor',60,False)
  deadline=time.monotonic()+10
  while time.monotonic()<deadline:
   state=runner.status(self.root,result['id'])
   if state.get('step')=='GPU status':break
   time.sleep(.05)
  self.assertEqual(state.get('step'),'GPU status',state)
  os.kill(state['pid'],signal.SIGTERM)
  while time.monotonic()<deadline:
   state=runner.status(self.root,result['id'])
   if state['state']=='cancelled':break
   time.sleep(.05)
  self.assertEqual(state['state'],'cancelled',state)
  self.assertFalse((self.root/'runs'/result['id']/'step-process.json').exists())
  with runner.acquire(self.root):pass
 def test_restore_failure_keeps_recovery_journal(self):
  job=self.job()
  def step(name,argv,*args,**kwargs):
   if str(argv[-1])=='start':raise RuntimeError('fixture restart failure')
  job.step=step
  try:
   with patch.object(runner.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'VANI running','')):
    with self.assertRaises(RuntimeError):
     with job.maintenance():pass
   self.assertTrue(runner.read(self.root/'maintenance.json')['active'])
  finally:job.log.close()


class IntegrityTests(unittest.TestCase):
 setUp=DebugTests.setUp
 tearDown=DebugTests.tearDown
 job=DebugTests.job
 def test_changed_release_source_is_not_run_as_the_original_commit(self):
  (self.source/'scripts/debug/runner.py').write_text('modified')
  with self.assertRaisesRegex(RuntimeError,'edited'):runner.start(self.root,self.install,'doctor',60,False)
 def test_recovery_clears_an_interrupted_journal_without_starting_stopped_production(self):
  job=self.job();job.save(createdAt=0,pid=99999999);job.log.close()
  runner.write(self.root/'latest.json',{'id':job.id})
  runner.write(self.root/'maintenance.json',{'active':True,'restoreProduction':False,'install':str(self.install)})
  self.assertTrue(runner.recover(self.root,self.install)['recovered'])
  self.assertFalse(runner.read(self.root/'maintenance.json')['active'])
  self.assertTrue(runner.load_job(self.root,job.id)['recovered'])


class RemoteTransportTests(unittest.TestCase):
 def test_transport_failure_reports_stderr_without_dumping_remote_script(self):
  spec=importlib.util.spec_from_file_location('debug_controller',pathlib.Path(__file__).parents[1]/'debug.py')
  controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
  error=subprocess.CalledProcessError(255,['ssh','private-long-script'],stderr=b'Connection failed')
  with patch.object(controller.subprocess,'run',side_effect=error):
   with self.assertRaisesRegex(RuntimeError,'Connection failed') as caught:controller.remote_command(['ssh'],'host',['python3','-c','private-long-script'],capture_output=True)
  self.assertNotIn('private-long-script',str(caught.exception))
 def test_shell_startup_noise_preserves_json_and_binary(self):
  spec=importlib.util.spec_from_file_location('debug_controller',pathlib.Path(__file__).parents[1]/'debug.py')
  controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
  with tempfile.TemporaryDirectory() as directory:
   ssh=pathlib.Path(directory)/'ssh'
   ssh.write_text("#!/bin/sh\nprintf 'Agent pid 123\\n'\nexec /bin/sh -c \"$2\"\n")
   ssh.chmod(0o700)
   result=controller.remote_command([str(ssh)],'host',[sys.executable,'-I','-c','print(\'{"ok":true}\')'],capture_output=True,text=True)
   self.assertEqual(json.loads(result.stdout),{'ok':True})
   stream=io.BytesIO()
   controller.remote_command([str(ssh)],'host',[sys.executable,'-I','-c','import sys;sys.stdout.buffer.write(bytes(range(256)))'],stdout=stream)
   self.assertEqual(stream.getvalue(),bytes(range(256)))

if __name__=='__main__':unittest.main()
