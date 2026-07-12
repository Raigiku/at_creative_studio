@echo off
REM Creative Studio launcher for Windows.
REM
REM The API key is loaded from the OS credential manager (Windows
REM Credential Manager). On first run, run scripts\set-key.bat to store it.
REM You can also set OPENROUTER_API_KEY in your environment to override.

setlocal

set STUDIO_PORT=7878

cd /d "%~dp0"

REM If a key is provided via env var, use that. Otherwise let the server
REM pull from the credential manager. We don't embed a placeholder key
REM anymore — the server will give a clear "no key found" error if neither
REM is set, and the launcher shows the hint below.

REM --- 1. Make sure the binary exists (build if needed) ---
if not exist studio.exe goto :build
goto :after_build

:build
echo Building studio.exe...
where go >nul 2>nul
if errorlevel 1 (
    echo ERROR: Go is not installed. Install Go 1.25 or newer from https://go.dev/dl/
    pause
    exit /b 1
)
go build -o studio.exe .
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

:after_build

REM --- 2. Pre-flight check: do we have a key somewhere? ---
REM We do a cheap probe: if the env var is empty, ask the binary whether
REM the credential manager has one. This avoids starting the server, only
REM to die with a "no key" error after the user has already waited for
REM the browser tab to open.
if not "%OPENROUTER_API_KEY%"=="" goto :have_key
call scripts\where-is-the-key.bat | findstr /C:"No key found" >nul
if not errorlevel 1 (
    echo.
    echo ============================================================
    echo   No OpenRouter API key found.
    echo.
    echo   Run this once to store your key in the OS credential
    echo   manager. You only need to do this once.
    echo.
    echo       scripts\set-key.bat
    echo.
    echo   Or set the OPENROUTER_API_KEY env var for this session:
    echo.
    echo       set OPENROUTER_API_KEY=sk-or-v1-...
    echo ============================================================
    echo.
    pause
    exit /b 1
)

:have_key

echo.
echo Starting Creative Studio on http://localhost:%STUDIO_PORT%
echo Close this window or press Ctrl+C to stop.
echo.

REM Open the browser after a short delay so the server is ready.
start "" /min cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%STUDIO_PORT%"

studio.exe
