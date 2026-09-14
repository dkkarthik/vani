#!/usr/bin/env bash
set -eu
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3 is required. Provide Python 3.10+ with SSL, bz2 and lzma, or ask the administrator for python3. No sudo is used.' >&2
  exit 2
fi
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$(dirname -- "$0")/setup/ubuntu.py" "$@"
