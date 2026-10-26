#!/usr/bin/env bash
set -euo pipefail

sdk_root=/tmp/ln-android-sdk
jdk_root=/tmp/ln-jdk21
sdk_zip=/tmp/ln-android-commandline-tools.zip
jdk_tar=/tmp/ln-jdk21.tar.gz
sdk_sha1=d313adb7aedccf6cf0cfca51ec180f0059f5f8f8
jdk_sha256=d7f5d5cf865a2902b70ff549b97586a7d3f234e016f041ab447ea740c7d66d1c

if ! printf '%s  %s\n' "$sdk_sha1" "$sdk_zip" | sha1sum -c - >/dev/null 2>&1; then
  curl -fLSs --retry 2 https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o "$sdk_zip"
  printf '%s  %s\n' "$sdk_sha1" "$sdk_zip" | sha1sum -c -
fi
if ! printf '%s  %s\n' "$jdk_sha256" "$jdk_tar" | sha256sum -c - >/dev/null 2>&1; then
  curl -fLSs --retry 2 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_x64_linux_hotspot_21.0.13_9.tar.gz' -o "$jdk_tar"
  printf '%s  %s\n' "$jdk_sha256" "$jdk_tar" | sha256sum -c -
fi

if [ ! -x "$sdk_root/cmdline-tools/latest/bin/sdkmanager" ]; then
  mkdir -p "$sdk_root/cmdline-tools/latest"
  unzip -q "$sdk_zip" -d "$sdk_root/cmdline-tools"
  mv "$sdk_root/cmdline-tools/cmdline-tools/"* "$sdk_root/cmdline-tools/latest/"
  rmdir "$sdk_root/cmdline-tools/cmdline-tools"
fi
if [ ! -x "$jdk_root/bin/javac" ]; then
  mkdir -p "$jdk_root"
  tar -xzf "$jdk_tar" -C "$jdk_root" --strip-components=1
fi

sdkmanager="$sdk_root/cmdline-tools/latest/bin/sdkmanager"
"$sdkmanager" --sdk_root="$sdk_root" --licenses < <(printf 'y\n%.0s' {1..100}) >/dev/null
"$sdkmanager" --sdk_root="$sdk_root" 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools' >/dev/null

truststore=/tmp/ln-android-cacerts
cp "$jdk_root/lib/security/cacerts" "$truststore"
if [ -n "${CODEX_PROXY_CERT:-}" ] && [ -f "$CODEX_PROXY_CERT" ]; then
  "$jdk_root/bin/keytool" -importcert -noprompt -alias codex-proxy -file "$CODEX_PROXY_CERT" -keystore "$truststore" -storepass changeit >/dev/null
fi
if [ -f /usr/local/share/ca-certificates/environment-proxy-ca.crt ]; then
  "$jdk_root/bin/keytool" -importcert -noprompt -alias environment-proxy -file /usr/local/share/ca-certificates/environment-proxy-ca.crt -keystore "$truststore" -storepass changeit >/dev/null
fi
echo 'Android SDK 35 and JDK 21 ready in /tmp; TLS verification remains enabled.'
