#!/usr/bin/env bash
#
# Dino-World build (Linux / macOS / WSL).
#
# Full clean rebuild of the shadow jar. Run after any source change,
# then re-run ./run.sh. The split exists so run.sh stays a fast pure
# supervisor.
set -euo pipefail
cd "$(dirname "$0")"

# Suppress JDK 24+ "restricted method" warning from Gradle's launcher JVM
# (it loads native-platform via System.load). Daemon JVM is covered by
# org.gradle.jvmargs in gradle.properties.
export GRADLE_OPTS="${GRADLE_OPTS:-} --enable-native-access=ALL-UNNAMED"

if [ ! -x ./gradlew ]; then
    echo "[build.sh] gradlew not executable. Run: chmod +x gradlew"
    exit 1
fi

echo "[build.sh] cleaning..."
./gradlew clean

echo "[build.sh] building shadow jar..."
./gradlew shadowJar

JAR=$(ls -1 build/libs/Dino-World-*-all.jar 2>/dev/null | head -1)
echo "[build.sh] done: ${JAR:-build/libs/Dino-World-*-all.jar}"
