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

echo [build.bat] cleaning...
call gradlew.bat clean
if errorlevel 1 (
    echo [build.bat] clean failed.
    exit /b 1
)

echo [build.bat] building shadow jar...
call gradlew.bat shadowJar
if errorlevel 1 (
    echo [build.bat] shadowJar failed.
    exit /b 1
)

set "JAR="
for /f "delims=" %%f in ('dir /b /a-d "build\libs\Dino-World-*-all.jar" 2^>nul') do if not defined JAR set "JAR=build\libs\%%f"
echo [build.bat] done: %JAR%
