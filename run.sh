#!/usr/bin/env bash
#
# Dino-World launcher (Linux / macOS / WSL).
#
# Pure supervisor — does not build. Run build.sh first after any source
# change. Behavior on JVM exit:
#
#   code 0    clean shutdown (/debug system shutdown) → stop
#   code 64   restart requested (/debug system restart) → relaunch
#   other     crash → relaunch with exponential backoff
#
# Backoff schedule: 1, 2, 4, 8, 16, 32, 60, 60… seconds.
# Resets to 1s after the bot stays up ≥ 60s.
#
# Circuit breaker: if 5 crashes occur within a 5-minute sliding window,
# the supervisor stops with exit 1 to prevent log-flood loops.
#
# Env overrides:
#   JAR        path to the shadow jar
#   JAVA_OPTS  JVM flags

cd "$(dirname "$0")" || exit 1

# Pick the newest shaded jar via a shell glob (parsing `ls` is fragile
# and shellcheck-noisy). The loop short-circuits on first match.
if [ -z "${JAR:-}" ]; then
    for f in build/libs/Dino-World-*-all.jar; do
        [ -f "$f" ] && JAR="$f" && break
    done
fi

# JAVA_OPTS is the conventional space-separated flag list. Split it
# into an array so each token becomes a separate java argument —
# `java "$JAVA_OPTS"` would pass the whole string as one argument and
# java would reject it.
read -r -a JAVA_OPTS_ARR <<< "${JAVA_OPTS:---enable-native-access=ALL-UNNAMED -Xmx256m -XX:+UseG1GC -Dfile.encoding=UTF-8 -Duser.timezone=UTC}"

if [ -z "$JAR" ] || [ ! -f "$JAR" ]; then
    echo "[run.sh] no shadow jar found at build/libs/Dino-World-*-all.jar."
    echo "[run.sh] Run ./build.sh to produce the shadow jar, then re-run ./run.sh."
    exit 1
fi

if [ ! -f .env ]; then
    echo "[run.sh] .env not found. Copy .env.example to .env and fill it in:"
    echo "         cp .env.example .env"
    exit 1
fi

echo "[run.sh] starting Dino-World (jar=$JAR)"
echo "[run.sh] press Ctrl+C to stop the supervisor."

backoff=1
# Sliding window of last 5 crash timestamps (epoch seconds).
crash_t=(0 0 0 0 0)

while true; do
    start_s=$(date +%s)
    java "${JAVA_OPTS_ARR[@]}" -jar "$JAR"
    code=$?
    end_s=$(date +%s)
    uptime=$((end_s - start_s))

    if [ "$code" -eq 0 ]; then
        echo "[run.sh] $(date '+%H:%M:%S') bot exited cleanly (code 0) -- stopping supervisor."
        exit 0
    fi

    if [ "$code" -eq 64 ]; then
        echo "[run.sh] $(date '+%H:%M:%S') restart requested (exit 64) -- relaunching..."
        backoff=1
        sleep 1
        continue
    fi

    # Crash path.
    echo "[run.sh] $(date '+%H:%M:%S') bot crashed with code $code after ${uptime}s of uptime."

    # Reset backoff if last run lasted long enough.
    if [ "$uptime" -ge 60 ]; then
        backoff=1
    fi

    # Shift the crash window and count crashes within the last 300s.
    crash_t=("${crash_t[@]:1}" "$end_s")
    recent=0
    for t in "${crash_t[@]}"; do
        if [ "$t" -ne 0 ] && [ $((end_s - t)) -lt 300 ]; then
            recent=$((recent + 1))
        fi
    done
    if [ "$recent" -ge 5 ]; then
        echo "[run.sh] crash loop detected -- 5 crashes within 5 minutes. Stopping supervisor."
        exit 1
    fi

    echo "[run.sh] backing off ${backoff}s before relaunch..."
    sleep "$backoff"

    backoff=$((backoff * 2))
    if [ "$backoff" -gt 60 ]; then
        backoff=60
    fi
done
