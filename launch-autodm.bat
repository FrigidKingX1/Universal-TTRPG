@echo off
REM Auto-DM Launcher
REM Prefers the built release executable; falls back to dev mode only
REM when no release build exists (requires Node + Rust + VS Build Tools).

title Auto-DM Launcher

cd /d "%~dp0"

set "RELEASE_EXE=src-tauri\target\release\auto-dm.exe"
set "DEV_EXE=src-tauri\target\debug\auto-dm.exe"

if exist "%RELEASE_EXE%" (
    echo Starting Auto-DM...
    start "" "%RELEASE_EXE%"
    exit /b 0
)

if exist "%DEV_EXE%" (
    echo Starting Auto-DM ^(debug build^)...
    start "" "%DEV_EXE%"
    exit /b 0
)

echo No built Auto-DM executable found.
echo.
set /p BUILD="Build it now? This requires Node.js, Rust, and VS Build Tools. [y/N] "
if /i not "%BUILD%"=="y" exit /b 1

:: Set up Rust/Cargo path
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

:: Set up Visual Studio build tools (vcvarsall)
set "VSVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat"
if exist "%VSVARS%" (
    call "%VSVARS%" x64 >nul 2>&1
) else (
    echo Warning: Visual Studio build tools not found at expected location.
    echo You may need to install VS Build Tools or adjust the path in this script.
)

echo Building Auto-DM (release). This can take several minutes on first run...
npm run tauri build
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

start "" "%RELEASE_EXE%"
exit /b 0
