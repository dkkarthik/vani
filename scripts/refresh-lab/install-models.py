#!/usr/bin/env python3
"""Explicitly install lab-owned macOS Ollama and local evaluation models."""
import hashlib, json, os, pathlib, platform, shutil, subprocess, sys, tarfile, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[2];STATE=ROOT/'.vani-refresh-lab'
URL='https://github.com/ollama/ollama/releases/download/v0.34.2/ollama-darwin.tgz'
SHA='f33b2a5aa59bc6c961ed3ec23ba9dc646ca6d99ced8d2a0d46eb3a522167dd3f'
if platform.system()!='Darwin' or platform.machine()!='arm64':raise SystemExit('This optional model bootstrap targets Apple Silicon macOS. Other hosts can use an existing loopback Ollama server.')
if not (STATE/'.lab-owned').exists():raise SystemExit('Start and stop the refresh lab first to initialize its private directory.')
os.umask(0o077)
subprocess.run([sys.executable,str(ROOT/'scripts/refresh-lab.py'),'stop'],check=True)
archive=STATE/'runtime/ollama-darwin.tgz';archive.parent.mkdir(exist_ok=True)
if not archive.exists():
 with urllib.request.urlopen(URL,timeout=60) as response,archive.open('wb') as f:shutil.copyfileobj(response,f)
h=hashlib.sha256()
with archive.open('rb') as f:
 for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
if h.hexdigest()!=SHA:raise SystemExit('Ollama archive checksum mismatch. Remove the incomplete archive and retry.')
dest=STATE/'runtime/ollama'
if not (dest/'ollama').exists():
 with tarfile.open(archive) as tf:tf.extractall(dest,filter='data')
(STATE/'runtime/ollama-release.json').write_text(json.dumps({'version':'0.34.2','sha256':SHA,'url':URL},indent=2))
settings={'OLLAMA_BASE_URL':'http://127.0.0.1:11436','OLLAMA_MODEL':'qwen3.5:9b','OLLAMA_EMBED_MODEL':'qwen3-embedding:0.6b','VANI_EMBED_MODEL':'qwen3-embedding:0.6b'}
(STATE/'models.json').write_text(json.dumps(settings,indent=2))
subprocess.run([sys.executable,str(ROOT/'scripts/refresh-lab.py'),'start'],check=True)
env=os.environ.copy();env.update(OLLAMA_HOST=settings['OLLAMA_BASE_URL'],OLLAMA_MODELS=str(STATE/'models'),OLLAMA_NO_CLOUD='1')
for name,model in [('embedding',settings['OLLAMA_EMBED_MODEL']),('reader',settings['OLLAMA_MODEL'])]:
 print('Downloading '+model+'; progress: '+str(STATE/'logs'/('pull-'+name+'.log')),flush=True)
 with (STATE/'logs'/('pull-'+name+'.log')).open('wb') as log:subprocess.run([str(dest/'ollama'),'pull',model],check=True,env=env,stdout=log,stderr=subprocess.STDOUT)
with urllib.request.urlopen(settings['OLLAMA_BASE_URL']+'/api/tags') as response:inventory=json.load(response)
(STATE/'installed-models.json').write_text(json.dumps(inventory,indent=2))
print('Local models installed. Digests: '+str(STATE/'installed-models.json'))
