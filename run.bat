@echo off
REM ============================================================
REM  Dino-World launcher (Windows).
REM
REM  Pure supervisor — does not build. Run build.bat first after any
REM  source change. Behavior on JVM exit:
REM
REM    code 0    clean shutdown (/debug system shutdown) -> stop
REM    code 64   restart requested (/debug system restart) -> relaunch
REM    other     crash -> relaunch with exponential backoff
REM
REM  Backoff schedule: 1, 2, 4, 8, 16, 32, 60, 60... seconds.
REM  Resets to 1s after the bot stays up >= 60s.
REM
REM  Circuit breaker: if 5 crashes occur within a 5-minute sliding
REM  window, the supervisor stops with exit 1 to prevent log-flood loops.
REM
REM  Env overrides:
REM    JAR        path to the shadow jar
REM    JAVA_OPTS  JVM flags
REM ============================================================

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM We deliberately do NOT switch the console codepage to UTF-8 (chcp
REM 65001) — cmd.exe in UTF-8 mode has a long-standing kernel-level bug
REM where partial multi-byte sequences at I/O buffer boundaries can drop
REM bytes, merging lines together.

if not defined JAR (
    for /f "delims=" %%f in ('dir /b /a-d "build\libs\Dino-World-*-all.jar" 2^>nul') do if not defined JAR set "JAR=build\libs\%%f"
)
if not defined JAVA_OPTS set "JAVA_OPTS=--enable-native-access=ALL-UNNAMED -Xmx256m -XX:+UseG1GC -Dfile.encoding=UTF-8 -Duser.timezone=UTC"

if not defined JAR (
    echo [run.bat] no shadow jar found at build\libs\Dino-World-*-all.jar.
    echo [run.bat] Run build.bat to produce the shadow jar, then re-run run.bat.
    exit /b 1
)
if not exist "%JAR%" (
    echo [run.bat] %JAR% not found.
    echo [run.bat] Run build.bat to produce the shadow jar, then re-run run.bat.
    exit /b 1
)

if not exist ".env" (
    echo [run.bat] .env not found. Copy .env.example to .env and fill it in:
    echo           copy .env.example .env
    exit /b 1
)

echo [run.bat] starting Dino-World (jar=%JAR%)
echo [run.bat] press Ctrl+C to stop the supervisor.

set "BACKOFF=1"
set "CRASH_COUNT=0"
set "CRASH_T1=0"
set "CRASH_T2=0"
set "CRASH_T3=0"
set "CRASH_T4=0"
set "CRASH_T5=0"

:loop
REM Record start time as seconds-since-midnight (good enough for uptime check).
for /f "tokens=1-3 delims=:.," %%a in ("!time: =0!") do set /a "START_S=%%a*3600+%%b*60+%%c"

java %JAVA_OPTS% -jar "%JAR%"
set "EC=!ERRORLEVEL!"

for /f "tokens=1-3 delims=:.," %%a in ("!time: =0!") do set /a "END_S=%%a*3600+%%b*60+%%c"
set /a "UPTIME=END_S-START_S"
if !UPTIME! lss 0 set /a "UPTIME+=86400"

if "!EC!"=="0" (
    echo [run.bat] bot exited cleanly (code 0) -- stopping supervisor.
    exit /b 0
)
if "!EC!"=="64" (
    echo [run.bat] restart requested (exit 64) -- relaunching...
    set "BACKOFF=1"
    timeout /t 1 /nobreak >nul
    goto loop
)

REM Crash path.
echo [run.bat] bot crashed with code !EC! after !UPTIME!s of uptime.

REM Reset backoff if last run lasted >= 60s.
if !UPTIME! geq 60 set "BACKOFF=1"

REM Circuit breaker: shift crash timestamps and count those within 300s.
set "CRASH_T1=!CRASH_T2!"
set "CRASH_T2=!CRASH_T3!"
set "CRASH_T3=!CRASH_T4!"
set "CRASH_T4=!CRASH_T5!"
set "CRASH_T5=!END_S!"

set "RECENT=0"
for %%t in (!CRASH_T1! !CRASH_T2! !CRASH_T3! !CRASH_T4! !CRASH_T5!) do (
    set /a "AGE=END_S-%%t"
    if !AGE! lss 0 set /a "AGE+=86400"
    if !AGE! lss 300 if %%t neq 0 set /a "RECENT+=1"
)
if !RECENT! geq 5 (
    echo [run.bat] crash loop detected -- 5 crashes within 5 minutes. Stopping supervisor.
    exit /b 1
)

echo [run.bat] backing off !BACKOFF!s before relaunch...
timeout /t !BACKOFF! /nobreak >nul

REM Double the backoff up to 60s.
set /a "BACKOFF*=2"
if !BACKOFF! gtr 60 set "BACKOFF=60"
goto loop
