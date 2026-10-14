#!/usr/bin/env bash
# Build a signed TWA APK for gust from android/twa-manifest.json with Bubblewrap, non-interactively.
#
# Requirements: Node >= 18, JDK 17 (JAVA_HOME), Android SDK (ANDROID_HOME) with
# "build-tools;36.1.0" and "platforms;android-36" installed and licenses accepted.
#
# Environment (all optional):
#   ANDROID_KEYSTORE_B64       base64 of a stable signing keystore. If unset, a throwaway one is generated.
#   ANDROID_KEYSTORE_PASSWORD  keystore password (required when ANDROID_KEYSTORE_B64 is set).
#   ANDROID_KEY_PASSWORD       key password (defaults to ANDROID_KEYSTORE_PASSWORD).
#   ANDROID_KEY_ALIAS          key alias (default: android).
#   APP_VERSION_CODE           integer versionCode (default: 1). Must increase for updates to install.
#   APP_VERSION_NAME           versionName (default: 1.0.<APP_VERSION_CODE>).
#
# Output: android/build/out/{app-release-signed.apk,app-release-bundle.aab,assetlinks.json,sha256.txt}
set -euo pipefail

BUBBLEWRAP_VERSION=1.27.0
BUILD_TOOLS_VERSION=36.1.0 # must match @bubblewrap/core BUILD_TOOLS_VERSION for $BUBBLEWRAP_VERSION

here="$(cd "$(dirname "$0")" && pwd)"
work="$here/build"
out="$work/out"

: "${JAVA_HOME:?JAVA_HOME must point to a JDK 17}"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
: "${sdk:?ANDROID_HOME must point to an Android SDK}"

if [ ! -d "$sdk/build-tools/$BUILD_TOOLS_VERSION" ]; then
  echo "error: $sdk/build-tools/$BUILD_TOOLS_VERSION is missing; install it with sdkmanager" >&2
  exit 1
fi

# Bubblewrap only accepts an SDK that has a top-level tools/ or bin/ directory. Modern SDKs keep
# sdkmanager under cmdline-tools/<version>/bin, so link it in when neither exists.
if [ ! -e "$sdk/tools" ] && [ ! -e "$sdk/bin" ]; then
  sdkmanager_bin="$(command -v sdkmanager || true)"
  if [ -z "$sdkmanager_bin" ] && [ -x "$sdk/cmdline-tools/latest/bin/sdkmanager" ]; then
    sdkmanager_bin="$sdk/cmdline-tools/latest/bin/sdkmanager"
  fi
  if [ -z "$sdkmanager_bin" ]; then
    echo "error: no sdkmanager found; cannot satisfy Bubblewrap's SDK path check" >&2
    exit 1
  fi
  ln -s "$(dirname "$sdkmanager_bin")" "$sdk/bin"
fi

rm -rf "$work"
mkdir -p "$out"
cd "$work"

alias_name="${ANDROID_KEY_ALIAS:-android}"
if [ -n "${ANDROID_KEYSTORE_B64:-}" ]; then
  : "${ANDROID_KEYSTORE_PASSWORD:?ANDROID_KEYSTORE_PASSWORD is required with ANDROID_KEYSTORE_B64}"
  printf '%s' "$ANDROID_KEYSTORE_B64" | base64 --decode > android.keystore
  store_pass="$ANDROID_KEYSTORE_PASSWORD"
  key_pass="${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}"
  echo "Signing with the provided keystore (alias: $alias_name)."
else
  # Throwaway key: APKs from different runs will not install over each other.
  store_pass="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
  key_pass="$store_pass"
  "$JAVA_HOME/bin/keytool" -genkeypair -noprompt \
    -keystore android.keystore -storetype PKCS12 \
    -alias "$alias_name" -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$store_pass" -keypass "$key_pass" \
    -dname "CN=gust, OU=gust, O=refcell, C=US"
  echo "warning: no ANDROID_KEYSTORE_B64 provided; signed with a freshly generated throwaway key." >&2
fi

version_code="${APP_VERSION_CODE:-1}"
version_name="${APP_VERSION_NAME:-1.0.$version_code}"

# Per-build twa-manifest.json: version + signing key. The checked-in file stays untouched.
SRC="$here/twa-manifest.json" DST="$work/twa-manifest.json" \
VCODE="$version_code" VNAME="$version_name" KALIAS="$alias_name" \
node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.env.SRC, "utf8"));
  m.appVersionCode = Number(process.env.VCODE);
  m.appVersionName = process.env.VNAME;
  m.appVersion = process.env.VNAME;
  m.signingKey = { path: "./android.keystore", alias: process.env.KALIAS };
  fs.writeFileSync(process.env.DST, JSON.stringify(m, null, 2) + "\n");
'

# Bubblewrap config: pre-filled so it never prompts to download a JDK or SDK.
# On macOS Bubblewrap appends /Contents/Home to jdkPath itself.
jdk_path="$JAVA_HOME"
if [ "$(uname -s)" = Darwin ]; then jdk_path="${jdk_path%/}"; jdk_path="${jdk_path%/Contents/Home}"; fi
JDK="$jdk_path" SDK="$sdk" node -e '
  require("fs").writeFileSync("bubblewrap-config.json",
    JSON.stringify({ jdkPath: process.env.JDK, androidSdkPath: process.env.SDK }) + "\n");
'

bubblewrap() {
  npx --yes "@bubblewrap/cli@$BUBBLEWRAP_VERSION" "$@" --config="$work/bubblewrap-config.json"
}

# `update` generates the Gradle project and manifest-checksum.txt non-interactively, so `build`
# finds a matching checksum and does not prompt to regenerate.
bubblewrap update --skipVersionUpgrade --manifest="$work/twa-manifest.json" --directory="$work"

# Bubblewrap reads the passwords from these env vars instead of prompting.
BUBBLEWRAP_KEYSTORE_PASSWORD="$store_pass" BUBBLEWRAP_KEY_PASSWORD="$key_pass" \
  bubblewrap build --skipPwaValidation --manifest="$work/twa-manifest.json"

"$sdk/build-tools/$BUILD_TOOLS_VERSION/apksigner" verify --print-certs app-release-signed.apk

fingerprint="$("$JAVA_HOME/bin/keytool" -list -v -keystore android.keystore -alias "$alias_name" \
  -storepass "$store_pass" | awk '/SHA256:/ { print $2; exit }')"
if [ -z "$fingerprint" ]; then
  echo "error: could not read SHA-256 certificate fingerprint" >&2
  exit 1
fi

cp app-release-signed.apk "$out/"
cp app-release-bundle.aab "$out/" 2>/dev/null || true
printf '%s\n' "$fingerprint" > "$out/sha256.txt"
FP="$fingerprint" PKG="$(node -p 'require("./twa-manifest.json").packageId')" node -e '
  const links = [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: process.env.PKG, sha256_cert_fingerprints: [process.env.FP] },
  }];
  require("fs").writeFileSync(process.argv[1], JSON.stringify(links, null, 2) + "\n");
' "$out/assetlinks.json"

echo "SHA-256 certificate fingerprint: $fingerprint"
echo "versionCode=$version_code versionName=$version_name"
ls -l "$out"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "fingerprint=$fingerprint"
    echo "version_name=$version_name"
    echo "version_code=$version_code"
  } >> "$GITHUB_OUTPUT"
fi
