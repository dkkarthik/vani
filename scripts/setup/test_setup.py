import contextlib, importlib.util, io, json, pathlib, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('ubuntu',pathlib.Path(__file__).with_name('ubuntu.py'));u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)

class SetupTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.base=pathlib.Path(self.temp.name);self.root=self.base/'source checkout';self.root.mkdir();self.state=self.base/'home/vani';self.state.parent.mkdir()
  for name,value in [('ROOT',self.root),('STATE',self.state),('APP',self.state/'app'),('CONFIG',self.state/'config/vani.env'),('PREFIX',self.state/'runtime/deps')]:
   p=patch.object(u,name,value);p.start();self.addCleanup(p.stop)
 def args(self,**kw):
  import argparse
  return argparse.Namespace(profile='app',check_network=False,json=False,yes=True,resume=False,skip_models=False,**kw)
 def test_config_is_data_not_shell(self):
  p=self.root/'.env';p.write_text('TOKEN="$(touch /tmp/never-run)"\nPATH_LITERAL=`id`\n')
  self.assertEqual(u.env_data(p),{'TOKEN':'$(touch /tmp/never-run)','PATH_LITERAL':'`id`'})
 def test_check_and_dry_run_never_install(self):
  with patch.object(u,'report',return_value={'supported':True,'ready':False,'checks':[]}),patch.object(u,'command',side_effect=AssertionError('mutation')),patch.object(u,'private_write',side_effect=AssertionError('write')),contextlib.redirect_stdout(io.StringIO()):
   self.assertEqual(u.main(['--check','--json']),2);self.assertEqual(u.main(['--dry-run','--profile','app']),2)
  self.assertFalse(self.state.exists())
 def test_real_report_lists_all_missing_without_writes(self):
  with patch.object(u,'output',return_value=None),patch.object(u.shutil,'which',return_value=None),patch.object(u,'read_url',side_effect=OSError('offline')):
   r=u.report(self.args())
  names={c['name'] for c in r['missing']}
  self.assertTrue({'node','npm','postgresql','pg-dump','vector','pg_trgm','poppler','xz','zstd','dependencies','database','build'}<=names)
  self.assertFalse(self.state.exists());self.assertNotIn('docker',names)
 def test_blockers_reported_before_writes(self):
  report={'supported':True,'ready':False,'checks':[{'name':'gpu','ready':False,'kind':'host','fix':'driver'}],'missing':[{}],'blockers':[{}]}
  stream=io.StringIO()
  with patch.object(u,'report',return_value=report),patch.object(u,'private_write',side_effect=AssertionError('write')),contextlib.redirect_stdout(stream): self.assertEqual(u.install(self.args()),2)
  self.assertIn('MISSING gpu',stream.getvalue());self.assertFalse(self.state.exists())
 def test_no_arguments_and_privileged_flags(self):
  with patch.object(u,'install',side_effect=AssertionError('installation')),contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
   self.assertEqual(u.main([]),0)
   with self.assertRaises(SystemExit):u.main(['--install','--install-driver'])
 def test_private_files_restrict_existing_permissions(self):
  p=self.root/'config';p.touch(mode=0o644);u.private_write(p,'secret');self.assertEqual(p.stat().st_mode&0o777,0o600)
  link=self.root/'link';link.symlink_to(p)
  with self.assertRaises(RuntimeError):u.private_write(link,'no')
 def test_config_paths_and_preserved_secret(self):
  settings=u.configure(self.args());u.validate_settings(settings)
  self.assertEqual(settings['VANI_DATA_DIR'],str(self.state/'data'))
  self.assertEqual(u.configure(self.args())['DATABASE_URL'],settings['DATABASE_URL'])
  for key,value in [('VANI_DATA_DIR','/elsewhere'),('DATABASE_URL','postgres://vani:secret@remote/vani'),('OLLAMA_BASE_URL','https://remote')]:
   with self.assertRaises(ValueError):u.validate_settings({**settings,key:value})
 def test_legacy_config_is_not_imported(self):
  (self.root/'.env').write_text('DATABASE_URL=postgres://old\n')
  self.assertIn(str(self.root/'.env'),u.legacy_paths());self.assertFalse(u.CONFIG.exists())
 def test_snapshot_handles_spaces_and_keeps_secrets_out(self):
  (self.root/'scripts').mkdir();(self.root/'scripts/test.py').write_text('print(1)')
  (self.root/'package.json').write_text('{}');(self.root/'.env').write_text('secret')
  (self.root/'apps').mkdir();(self.root/'apps/node_modules').mkdir();self.state.mkdir()
  u.snapshot();self.assertTrue((u.APP/'scripts/test.py').exists());self.assertFalse((u.APP/'.env').exists());self.assertFalse((u.APP/'apps/node_modules').exists())
  (self.root/'scripts/test.py').unlink();u.snapshot();self.assertFalse((u.APP/'scripts/test.py').exists())
 def test_private_caches(self):
  env=u.runtime_env();self.assertEqual(env['TMPDIR'],str(self.state/'tmp'));self.assertEqual(env['npm_config_cache'],str(self.state/'cache/npm'));self.assertEqual(env['OLLAMA_MODELS'],str(self.state/'models'))
 def test_database_environment_expands_url_without_exposing_credentials_in_argv(self):
  settings=u.configure(self.args())
  with patch.dict(u.os.environ,{'PGHOST':'remote','PGDATABASE':'other','PGSERVICE':'external'}):env=u.postgres_env(settings)
  self.assertEqual(env['PGHOST'],'127.0.0.1');self.assertEqual(env['PGPORT'],'55432');self.assertEqual(env['PGDATABASE'],'vani');self.assertNotIn('PGSERVICE',env)
  self.assertTrue(env['PGPASSWORD']);self.assertEqual(u.postgres_env(settings,'postgres')['PGDATABASE'],'postgres')
 def test_migration_failure_stops_database_and_leaves_backup(self):
  settings=u.configure(self.args());(self.state/'postgres').mkdir();(self.state/'postgres/.vani-owned').touch();(self.state/'postgres/PG_VERSION').write_text('18');(self.state/'backups').mkdir()
  calls=[]
  def record(args,**kw):calls.append([str(a) for a in args])
  with patch.object(u,'command',side_effect=record),patch.object(u,'output',side_effect=['1','2']),patch.object(u.socket,'socket'):
   with self.assertRaisesRegex(RuntimeError,'migration'):u.database(settings,lambda:(_ for _ in ()).throw(RuntimeError('migration')))
  self.assertEqual(calls[-1][-1],'stop');self.assertTrue(any('pg_dump' in c[0] for c in calls));self.assertEqual(len(list((self.state/'backups').iterdir())),1)
 def test_unmanaged_or_wrong_major_database_rejected(self):
  settings=u.configure(self.args());cluster=self.state/'postgres';cluster.mkdir()
  with self.assertRaisesRegex(RuntimeError,'unmanaged'):u.database(settings,lambda:None)
  (cluster/'.vani-owned').touch();(cluster/'PG_VERSION').write_text('17')
  with self.assertRaisesRegex(RuntimeError,'major-version'):u.database(settings,lambda:None)
 def test_checksum_failure_never_extracts(self):
  (self.state/'tmp').mkdir(parents=True)
  with patch.object(u.urllib.request,'urlopen',return_value=io.BytesIO(b'bad archive')),patch.object(u,'command',side_effect=AssertionError('extract')):
   with self.assertRaisesRegex(RuntimeError,'checksum mismatch'):u.download_runtime('micromamba')
  self.assertFalse((self.state/'runtime/micromamba').exists())
 def test_install_orchestrates_only_home_owned_commands(self):
  (self.root/'package.json').write_text('{}')
  ready={'supported':True,'ready':True,'checks':[],'missing':[],'blockers':[],'models':{}}
  calls=[]
  def command(args,**kw):calls.append(([str(a) for a in args],kw))
  with patch.object(u,'report',return_value=ready),patch.object(u.os,'geteuid',return_value=1000),patch.object(u,'download_runtime') as downloads,patch.object(u,'install_environment'),patch.object(u,'database',side_effect=lambda settings,migrate:migrate()),patch.object(u,'command',side_effect=command),contextlib.redirect_stdout(io.StringIO()):
   old_umask=u.os.umask(0o077)
   try:self.assertEqual(u.install(self.args()),0)
   finally:u.os.umask(old_umask)
  self.assertEqual([c.args[0] for c in downloads.call_args_list],['micromamba','conda','node'])
  self.assertTrue(u.CONFIG.exists());self.assertTrue((self.state/'bin/vani').exists());self.assertTrue((self.state/'health.json').exists())
  for args,kw in calls:
   if args[0]=='npm':self.assertEqual(kw['cwd'],u.APP);self.assertEqual(kw['env']['CONDA_REGISTER_ENVS'],'false')
  package_call=next((args,kw) for args,kw in calls if args[:2]==['npm','ci'])
  self.assertEqual(package_call[0],['npm','ci','--include=dev'])
  self.assertEqual(package_call[1]['env']['NODE_ENV'],'production')
  self.assertEqual(calls[-1][0],[str(self.state/'bin/vani'),'start'])
 def test_no_privileged_or_system_service_commands(self):
  import ast
  for name in ('ubuntu.py','control.py','launch.py'):
   tree=ast.parse(pathlib.Path(__file__).with_name(name).read_text())
   values={n.value for n in ast.walk(tree) if isinstance(n,ast.Constant) and isinstance(n.value,str)}
   self.assertFalse({'sudo','apt-get','docker','systemctl','loginctl','ubuntu-drivers'} & values)
if __name__=='__main__':unittest.main()
