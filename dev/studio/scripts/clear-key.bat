@echo off
REM Remove the API key from the Windows Credential Manager.
REM Native tool: cmdkey (built into Windows).

setlocal

REM First check whether the credential exists, then delete it. We do it
REM in two steps because cmdkey's exit code is unreliable for "not found".
cmdkey /list:creative-studio >nul 2>&1
if errorlevel 1 (
    echo No key was stored.
    endlocal
    exit /b 0
)

cmdkey /delete:creative-studio >nul 2>&1
echo Removed API key from Windows Credential Manager.
endlocal
