import importlib.util, pathlib, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('ubuntu',pathlib.Path(__file__).with_name('ubuntu.py'));u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
class SetupTests(unittest.TestCase):
 def test_config_is_data_not_shell(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'.env';p.write_text('TOKEN="$(touch /tmp/never-run)"\nPATH_LITERAL=`id`\n# comment\n')
   self.assertEqual(u.env_data(p),{'TOKEN':'$(touch /tmp/never-run)','PATH_LITERAL':'`id`'})
 def test_check_and_dry_run_never_install(self):
  with patch.object(u,'report',return_value={'supported':True,'ready':False,'checks':[]}),patch.object(u,'command',side_effect=AssertionError('mutation')),patch.object(u,'private_write',side_effect=AssertionError('write')):
   self.assertEqual(u.main(['--check','--json']),2);self.assertEqual(u.main(['--dry-run','--profile','app']),2)
 def test_no_arguments_do_not_install(self):
  with patch.object(u,'install',side_effect=AssertionError('installation')):self.assertEqual(u.main([]),0)
 def test_unsupported_host(self):
  with patch.object(u,'report',return_value={'supported':False,'ready':False,'checks':[]}):self.assertEqual(u.main(['--check']),3)
 def test_private_files_and_service_escaping(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'config';u.private_write(p,'secret');self.assertEqual(p.stat().st_mode&0o777,0o600)
  self.assertEqual(u.systemd_quote('/My Drive/100%'), '"/My Drive/100%%"')
if __name__=='__main__':unittest.main()
