#!/usr/bin/env bash
# ssayuz 안드로이드 앱(APK) 빌드 — 공식 SDK 없이 최소 도구로 조립
#
# 필요한 것 (Ubuntu): sudo apt install aapt zipalign apksigner dalvik-exchange openjdk-21-jdk-headless
#                    + android.jar 두 개:
#                      ANDROID_JAR=API 35 (자바 컴파일용)
#                      AAPT_JAR=API 33 (리소스용 — 우분투 aapt가 35 형식을 못 읽어서. 앱은 그대로 35를 대상으로 해요)
# 서명 키:            KEYSTORE=ssayuz-release.jks  KS_PASS=비밀번호  KEY_ALIAS=ssayuz
#
# 사용법: VERSION_CODE=1 VERSION_NAME=1.0 ./build.sh   → build/ssayuz-1.0.apk
set -euo pipefail
cd "$(dirname "$0")"

: "${ANDROID_JAR:?ANDROID_JAR 경로를 지정하세요}"
AAPT_JAR="${AAPT_JAR:-$ANDROID_JAR}"
: "${KEYSTORE:?KEYSTORE(서명 키 파일) 경로를 지정하세요}"
: "${KS_PASS:?KS_PASS(키 비밀번호)를 지정하세요}"
KEY_ALIAS="${KEY_ALIAS:-ssayuz}"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"
MIN_SDK=24
TARGET_SDK=35

OUT=build
rm -rf "$OUT" && mkdir -p "$OUT/gen" "$OUT/classes"

echo "▶ 1/5 리소스 묶기 (aapt)"
aapt package -f -m \
  -M AndroidManifest.xml -S res -I "$AAPT_JAR" \
  -J "$OUT/gen" -F "$OUT/app.unsigned.apk" \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -0 arsc

echo "▶ 2/5 자바 컴파일 (javac)"
javac -nowarn -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -Xlint:-options \
  -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')

echo "▶ 3/5 dex 변환 (dx)"
dalvik-exchange --dex --min-sdk-version=$MIN_SDK --output="$OUT/classes.dex" "$OUT/classes"

echo "▶ 4/5 dex 넣고 정렬 (zipalign)"
(cd "$OUT" && aapt add -f app.unsigned.apk classes.dex > /dev/null)
zipalign -f -p 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"

echo "▶ 5/5 서명 (apksigner, v1+v2+v3)"
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KEY_ALIAS" \
  --min-sdk-version $MIN_SDK --out "$OUT/ssayuz-$VERSION_NAME.apk" "$OUT/app.aligned.apk"
apksigner verify --verbose "$OUT/ssayuz-$VERSION_NAME.apk" | head -5
echo "✅ $OUT/ssayuz-$VERSION_NAME.apk"
