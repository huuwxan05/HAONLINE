#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IOS="$ROOT/mobile/ios"
PROJECT="$IOS/HAONLINE.xcodeproj"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[ios] iOS builds require macOS with Xcode."
  exit 1
fi

if command -v xcodegen >/dev/null 2>&1; then
  cd "$IOS"
  xcodegen generate
elif [ ! -d "$PROJECT" ]; then
  echo "[ios] xcodegen is not installed and HAONLINE.xcodeproj does not exist."
  echo "[ios] Install XcodeGen with: brew install xcodegen"
  exit 1
fi

open "$PROJECT"
