import io, json, os, pathlib, tarfile, tempfile, unittest
from unittest.mock import patch, MagicMock
import update

class UpdateTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='vani update ');self.root=pathlib.Path(self.temp.name)
  for name in ('app/scripts','logs','updates'): (self.root/name).mkdir(parents=True,exist_ok=True)
  (self.root/'app/.vani-owned').touch();(self.root/'profile').write_text('local-5090')
  (self.root/'app/scripts/example.py').write_text('original')
  update.write(self.root/'app/build-identity.json',{'commit':'a'*40,'dirty':False,'digest':update.source_digest(self.root/'app')})
  update.write(self.root/'updates/latest.json',{'commit':'b'*40,'timestamp':0})
 def tearDown(self): self.temp.cleanup()
 def archive(self, name='vani/scripts/setup-ubuntu.sh', kind=tarfile.REGTYPE):
  path=self.root/'archive.tar.gz'
  with tarfile.open(path,'w:gz') as out:
   entry=tarfile.TarInfo(name);entry.type=kind
   if kind==tarfile.REGTYPE: entry.size=4;out.addfile(entry,io.BytesIO(b'test'))
   else: entry.linkname='/etc/passwd';out.addfile(entry)
  return path
 def test_archive_rejects_traversal_and_links(self):
  for name,kind in [('../escape',tarfile.REGTYPE),('/escape',tarfile.REGTYPE),('vani/link',tarfile.SYMTYPE),('vani/hard',tarfile.LNKTYPE)]:
   with self.subTest(name=name), self.assertRaises(ValueError): update.unpack(self.archive(name,kind),self.root/'extract')
 def test_archive_extracts_valid_source(self):
  destination=self.root/'extract';destination.mkdir()
  source=update.unpack(self.archive(),destination)
  self.assertTrue((source/'scripts/setup-ubuntu.sh').is_file())
 def test_changed_sources_cannot_be_replaced(self):
  (self.root/'app/scripts/example.py').write_text('local changes')
  with self.assertRaisesRegex(ValueError,'edited'):update.start(self.root,'b'*40)
 def test_new_source_file_also_prevents_update(self):
  (self.root/'app/scripts/new.py').write_text('local changes')
  with self.assertRaisesRegex(ValueError,'edited'):update.start(self.root,'b'*40)
 def test_generated_outputs_do_not_change_digest(self):
  before=update.source_digest(self.root/'app')
  (self.root/'app/node_modules').mkdir();(self.root/'app/node_modules/file').write_text('generated')
  (self.root/'app/apps/api/dist').mkdir(parents=True);(self.root/'app/apps/api/dist/file.js').write_text('generated')
  self.assertEqual(before,update.source_digest(self.root/'app'))
 def test_only_checked_sha_is_accepted(self):
  for commit in ('--help','c'*40):
   with self.assertRaises(ValueError):update.start(self.root,commit)
 def test_concurrent_start_is_coalesced(self):
  held=update.lock(self.root)
  update.write(self.root/'updates/status.json',{'state':'installing','target':'b'*40})
  try:
   with patch.object(update.subprocess,'Popen') as spawn:
    self.assertEqual(update.start(self.root,'b'*40)['job']['state'],'installing');spawn.assert_not_called()
  finally:held.close()
 def test_interrupted_job_is_not_successful(self):
  update.write(self.root/'updates/status.json',{'state':'installing'})
  self.assertEqual(update.status(self.root)['job']['state'],'failed')
 def test_check_is_cached(self):
  with patch.object(update.urllib.request,'urlopen') as fetch:
   fetch.return_value.__enter__.return_value=io.BytesIO(json.dumps({'sha':'b'*40}).encode())
   self.assertTrue(update.check(self.root)['available'])
   update.check(self.root);self.assertEqual(fetch.call_count,1)
 def test_check_failure_is_visible(self):
  with patch.object(update.urllib.request,'urlopen',side_effect=OSError('network')):
   self.assertIn('Could not check',update.check(self.root)['checkError'])
 def test_worker_failure_is_recorded(self):
  held=update.lock(self.root);fd=os.dup(held.fileno())
  with patch.object(update.urllib.request,'urlopen',side_effect=OSError('network')):
   self.assertEqual(update.run(self.root,'b'*40,fd),1)
  held.close();self.assertEqual(update.read(self.root/'updates/status.json')['state'],'failed')
 def test_worker_uses_pinned_archive_and_existing_root_profile(self):
  archive=self.archive().read_bytes();held=update.lock(self.root);fd=os.dup(held.fileno())
  def installed(*args,**kwargs):
   self.assertIn('--skip-models',args[0]);self.assertEqual(args[0][-1],str(self.root));self.assertIn('local-5090',args[0])
   update.write(self.root/'app/build-identity.json',{'commit':'b'*40})
  try:
   with patch.object(update.urllib.request,'urlopen') as fetch,patch.object(update.subprocess,'run',side_effect=installed):
    fetch.return_value.__enter__.return_value=io.BytesIO(archive)
    self.assertEqual(update.run(self.root,'b'*40,fd),0)
    self.assertTrue(fetch.call_args.args[0].full_url.endswith('/'+'b'*40))
   self.assertEqual(update.read(self.root/'updates/status.json')['state'],'complete')
  finally:held.close()

 def test_reload_check_bypasses_fresh_cache(self):
  with patch.object(update.urllib.request,'urlopen') as fetch:
   fetch.return_value.__enter__.side_effect=lambda:io.BytesIO(json.dumps({'sha':'b'*40}).encode())
   update.check(self.root); update.check(self.root,force=True)
   self.assertEqual(fetch.call_count,2)
 def test_regular_checks_expire_after_two_hours(self):
  with patch.object(update.time,'time',return_value=20000) as clock,patch.object(update.urllib.request,'urlopen') as fetch:
   fetch.return_value.__enter__.side_effect=lambda:io.BytesIO(json.dumps({'sha':'b'*40}).encode())
   update.check(self.root)
   clock.return_value=27199;update.check(self.root);self.assertEqual(fetch.call_count,1)
   clock.return_value=27200;update.check(self.root);self.assertEqual(fetch.call_count,2)
 def test_failed_check_does_not_offer_stale_update(self):
  with patch.object(update.urllib.request,'urlopen',side_effect=OSError('offline')):
   self.assertFalse(update.check(self.root,force=True)['available'])
  with self.assertRaisesRegex(ValueError,'Check for updates again'):update.start(self.root,'b'*40)
 def test_matching_commit_does_not_offer_update(self):
  with patch.object(update.urllib.request,'urlopen') as fetch:
   fetch.return_value.__enter__.return_value=io.BytesIO(json.dumps({'sha':'a'*40}).encode())
   self.assertFalse(update.check(self.root)['available'])
