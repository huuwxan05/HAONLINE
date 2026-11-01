#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DESKTOP="$ROOT/desktop"

if [ ! -d "$DESKTOP/node_modules/electron" ] || [ ! -d "$DESKTOP/node_modules/electron-builder" ]; then
  echo "[windows] Desktop dependencies are not installed."
  echo "[windows] Run: cd desktop && npm install"
  exit 1
fi

if ! command -v wine >/dev/null 2>&1 && [ "$(uname -s)" != "Darwin" ]; then
  echo "[windows] Cross-building the NSIS installer on Linux requires Wine."
  echo "[windows] Build on Windows, or install Wine and retry."
  echo "[windows] You can still create an unpacked directory with: cd desktop && npm run package:dir"
  exit 1
fi

cd "$DESKTOP"
npm run package

ARTIFACT=$(find "$DESKTOP/release" -maxdepth 2 -name 'HAONLINE-Setup-*.exe' -print -quit)
if [ -z "$ARTIFACT" ]; then
  echo "[windows] installer was not produced"
  exit 1
fi

ls -lh "$ARTIFACT"
echo "[windows] installer ready: $ARTIFACT"
