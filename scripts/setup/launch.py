#!/usr/bin/env python3
"""Start the built application with .env parsed as data, never shell code."""
import os, pathlib, signal, subprocess, sys
from ubuntu import ROOT, STATE, env_data
settings=os.environ.copy();settings.update(env_data(ROOT/'.env'))
node=STATE/'runtime/node/bin/node'
if not node.exists():node=pathlib.Path('node')
children=[]
def stop(*args):
    for child in children:
        if child.poll() is None:child.terminate()
    for child in children:
        try:child.wait(timeout=10)
        except subprocess.TimeoutExpired:child.kill()
    sys.exit(0 if args else 1)
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
try:
    children.append(subprocess.Popen([str(node),'apps/api/dist/index.js'],cwd=ROOT,env=settings))
    children.append(subprocess.Popen([str(node),'scripts/serve-local.mjs'],cwd=ROOT,env=settings))
    while all(p.poll() is None for p in children):
        try:children[0].wait(timeout=1)
        except subprocess.TimeoutExpired:pass
finally:stop()
