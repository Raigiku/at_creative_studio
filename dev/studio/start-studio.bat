@echo off
REM Creative Studio launcher for Windows.
REM
REM The API key is loaded in this order:
REM   1. $OPENROUTER_API_KEY env var (always wins if set)
REM   2. .ai-creative-studio.env file ONE DIRECTORY ABOVE the repo
REM
REM Example: if the repo is at c:\custom\projects\ai_creative_studio,
REM the .env file should live at c:\custom\projects\.ai-creative-studio.env
REM with the line:
REM     OPENROUTER_API_KEY=sk-or-v1-...

setlocal

set STUDIO_PORT=7878

cd /d "%~dp0"

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
REM Fast path: env var is set. The server will use it directly.
if not "%OPENROUTER_API_KEY%"=="" goto :have_key

REM Slow path: probe the .env file by walking up from this script's
REM directory, just like the server does. We mirror the server's logic
REM here so the user gets a clear hint BEFORE the server even starts.
set ENV_DIR=%~dp0
set ENV_FOUND=
:probe_env
if "%ENV_DIR%"=="" goto :probe_done
if "%ENV_DIR:~-1%"=="\" set ENV_DIR=%ENV_DIR:~0,-1%
if exist "%ENV_DIR%\.ai-creative-studio.env" (
    set "ENV_FOUND=%ENV_DIR%\.ai-creative-studio.env"
    goto :probe_done
)
for %%P in ("%ENV_DIR%") do set "ENV_DIR=%%~dpP"
goto :probe_env

:probe_done
if defined ENV_FOUND goto :have_key

echo.
echo ============================================================
echo   No OpenRouter API key found.
echo.
echo   Create this file (one directory above the repo):
echo       %~dp0..\.ai-creative-studio.env
echo.
echo   With the single line:
echo       OPENROUTER_API_KEY=sk-or-v1-...
echo.
echo   Or set OPENROUTER_API_KEY in your environment for this
echo   session.
echo ============================================================
echo.
pause
exit /b 1

:have_key

echo.
echo Starting Creative Studio on http://localhost:%STUDIO_PORT%
echo Close this window or press Ctrl+C to stop.
echo.

REM Open the browser after a short delay so the server is ready.
start "" /min cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%STUDIO_PORT%"

studio.exe
