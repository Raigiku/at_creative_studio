@echo off
REM Save your OpenRouter API key to the OS credential manager (Windows
REM Credential Manager). The key is stored encrypted and reused by the
REM server on every launch.
REM
REM Usage:
REM   set-key                       prompts for the key (input is hidden)
REM   set-key sk-or-v1-...          stores the key from the first arg
REM
REM After this you can run start-studio.bat without setting any env vars.
REM
REM Native tool: cmdkey (built into Windows since Vista).

setlocal

set SERVICE=creative-studio
set USER=openrouter-api-key

if "%~1"=="" goto :prompt
set "KEY=%~1"
goto :store

:prompt
REM Read the key with echo disabled. PowerShell's Read-Host -AsSecureString
REM doesn't echo the input; we then unsecure it for cmdkey to consume.
echo Enter your OpenRouter API key (input is hidden):
for /f "delims=" %%K in ('powershell -NoProfile -Command "$p = Read-Host -AsSecureString; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); $s = [Runtime.InteropServices.Marshal]::PtrToStringAuto($b); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); Write-Output $s"') do set "KEY=%%K"

:store
if "%KEY%"=="" (
    echo ERROR: empty key; nothing stored.
    exit /b 1
)
echo %KEY%| cmdkey /generic:%SERVICE% /user:%USER% /pass:stdin >nul
if errorlevel 1 (
    echo ERROR: cmdkey failed to store the credential.
    exit /b 1
)
echo.
echo Stored API key in Windows Credential Manager under:
echo   Target:    %SERVICE%
echo   Username:  %USER%
echo.
echo You can now run start-studio.bat (or ./start-studio.sh on macOS/Linux) without setting any env vars.
endlocal
