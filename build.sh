#!/usr/bin/env bash
#
# Dino-World build (Linux / macOS / WSL).
#
# Full clean rebuild of the shadow jar. Run after any source change,
# then re-run ./run.sh. The split exists so run.sh stays a fast pure
# supervisor.
set -euo pipefail
cd "$(dirname "$0")" || exit 1

# Suppress JDK 24+ "restricted method" warning from Gradle's launcher JVM
# (it loads native-platform via System.load). Daemon JVM is covered by
# org.gradle.jvmargs in gradle.properties.
export GRADLE_OPTS="${GRADLE_OPTS:-} --enable-native-access=ALL-UNNAMED"

if [ ! -x ./gradlew ]; then
    echo "[build.sh] gradlew not executable. Run: chmod +x gradlew"
    exit 1
fi

echo "[build.sh] clean + shadowJar..."
# Single gradlew invocation: one daemon roundtrip for both tasks
# instead of two. Gradle's own log still shows which task failed.
./gradlew clean shadowJar

# Pick the newest shaded jar via a shell glob (parsing `ls` is fragile
# and shellcheck-noisy). The loop short-circuits on first match.
JAR=""
for f in build/libs/Dino-World-*-all.jar; do
    [ -f "$f" ] && JAR="$f" && break
done
echo "[build.sh] done: ${JAR:-build/libs/Dino-World-*-all.jar}"
