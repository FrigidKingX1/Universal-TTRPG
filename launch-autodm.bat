@echo off
REM Auto-DM Launcher - Starts the Tauri development server
REM This script sets up the environment and launches the app

title Auto-DM Launcher

:: Set up Rust/Cargo path
set "CARGO_PATH=%USERPROFILE%\.cargo\bin"
set "PATH=%CARGO_PATH%;%PATH%"

:: Set up Visual Studio build tools (vcvarsall)
set "VSVARS="C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat""
if exist %VSVARS% (
    call %VSVARS% x64 >nul 2>&1
) else (
    echo Warning: Visual Studio build tools not found at expected location
    echo You may need to install VS Build Tools or adjust the path in this script.
)

:: Change to project directory
cd /d "%~dp0"

echo Starting Auto-DM...
echo.

:: Run the Tauri development server
npm run tauri dev

echo.
echo Auto-DM has exited.
pause