@echo off
REM ============================================================
REM  Dino-World build (Windows).
REM
REM  Full clean rebuild of the shadow jar. Run after any source change,
REM  then re-run run.bat. The split exists so run.bat stays a fast
REM  pure supervisor.
REM ============================================================

setlocal EnableExtensions
cd /d "%~dp0"

REM Suppress JDK 24+ "restricted method" warning from Gradle's launcher
REM JVM (it loads native-platform via System.load). Daemon JVM is covered
REM by org.gradle.jvmargs in gradle.properties.
set "GRADLE_OPTS=%GRADLE_OPTS% --enable-native-access=ALL-UNNAMED"

echo [build.bat] clean + shadowJar...
REM Single gradlew invocation: one daemon roundtrip for both tasks
REM instead of two. Gradle's own log still shows which task failed.
call gradlew.bat clean shadowJar
if errorlevel 1 (
    echo [build.bat] build failed.
    exit /b 1
)

REM /o-d sorts by date descending so the newest jar wins when multiple
REM version-suffixed shaded jars happen to coexist in build\libs.
set "JAR="
for /f "delims=" %%f in ('dir /b /o-d /a-d "build\libs\Dino-World-*-all.jar" 2^>nul') do if not defined JAR set "JAR=build\libs\%%f"
echo [build.bat] done: %JAR%
