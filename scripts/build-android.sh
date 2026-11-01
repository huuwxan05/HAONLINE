#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [ -z "$SDK" ] && [ -d /opt/android-sdk ]; then SDK=/opt/android-sdk; fi
export ANDROID_SDK_ROOT="$SDK"
BASE_URL="${HAONLINE_BASE_URL:-http://127.0.0.1:8080}"

if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  echo "[android] Android SDK not found."
  echo "[android] Install the Android command-line tools, then set ANDROID_SDK_ROOT."
  echo "[android] Required packages: platform-tools, platforms;android-34, build-tools;34.0.0"
  exit 1
fi

if [ -x "$ROOT/mobile/android/gradlew" ]; then
  GRADLE="$ROOT/mobile/android/gradlew"
elif command -v gradle >/dev/null 2>&1; then
  GRADLE="gradle"
elif [ -x /opt/gradle/bin/gradle ]; then
  GRADLE=/opt/gradle/bin/gradle
else
  echo "[android] Gradle not found. Install Gradle 8.9+ or add the Gradle wrapper."
  exit 1
fi

echo "[android] base URL: $BASE_URL"
if [ "$GRADLE" = "gradle" ]; then
  (cd "$ROOT/mobile/android" && gradle --no-daemon assembleDebug -PHAONLINE_BASE_URL="$BASE_URL")
else
  (cd "$ROOT/mobile/android" && "$GRADLE" --no-daemon assembleDebug -PHAONLINE_BASE_URL="$BASE_URL")
fi

APK="$ROOT/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "[android] build completed but APK was not found at $APK"
  exit 1
fi

ls -lh "$APK"
echo "[android] APK ready: $APK"
