#!/usr/bin/env bash
set -eu
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3 is required. Install Ubuntu python3, then run this script again.' >&2
  exit 2
fi
exec python3 "$(dirname -- "$0")/setup/ubuntu.py" "$@"
