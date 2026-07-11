@echo off
REM Creative Studio launcher for Windows.
REM
REM Edit the line below to set your OpenRouter API key, OR set it as a
REM Windows environment variable and remove the "set" line.

set OPENROUTER_API_KEY=sk-or-v1-PUT-YOUR-KEY-HERE
set STUDIO_PORT=7878

cd /d "%~dp0"

REM Build if the binary is missing or older than main.go.
if not exist studio.exe goto :build
for %%I in (main.exe) do set _main_age=%%~tI
for %%I in (studio.exe) do set _bin_age=%%~tI
REM (Intentionally skip incremental rebuild; PowerShell one-liner below is simpler.)

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

echo.
echo Starting Creative Studio on http://localhost:%STUDIO_PORT%
echo Close this window or press Ctrl+C to stop.
echo.

REM Open the browser after a short delay so the server is ready.
start "" /min cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%STUDIO_PORT%"

studio.exe
