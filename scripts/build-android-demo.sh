#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/tmp/ln-jdk21}"
export ANDROID_HOME="${ANDROID_HOME:-/tmp/ln-android-sdk}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-/tmp/ln-gradle-home}"

gradle_args=(assembleDebug --no-daemon --console=plain)
if [ -n "${HTTPS_PROXY:-}" ]; then
  read -r proxy_host proxy_port < <(python3 - <<'PY'
import os
from urllib.parse import urlsplit
proxy=urlsplit(os.environ['HTTPS_PROXY'])
print(proxy.hostname or '', proxy.port or 8080)
PY
  )
  if [ -n "$proxy_host" ]; then
    gradle_args+=("-Dhttp.proxyHost=$proxy_host" "-Dhttp.proxyPort=$proxy_port" "-Dhttps.proxyHost=$proxy_host" "-Dhttps.proxyPort=$proxy_port")
    export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Dhttp.proxyHost=$proxy_host -Dhttp.proxyPort=$proxy_port -Dhttps.proxyHost=$proxy_host -Dhttps.proxyPort=$proxy_port"
  fi
fi
if [ -f /tmp/ln-android-cacerts ]; then
  export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Djavax.net.ssl.trustStore=/tmp/ln-android-cacerts -Djavax.net.ssl.trustStorePassword=changeit"
fi
cd "$project_root/android-customer"
./gradlew "${gradle_args[@]}"
echo 'APK: android-customer/app/build/outputs/apk/debug/app-debug.apk'
