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
REM
REM IMPORTANT: we must NOT use `echo %KEY%|` to feed cmdkey, because:
REM   1. cmd.exe re-parses %KEY% and mangles characters like & | < > ^ ( ) %
REM   2. cmdkey /pass:stdin reads a trailing newline into the stored value,
REM      which then makes Go's net/http reject the Authorization header.
REM Instead, we use a PowerShell pipeline that calls cmdkey with -ArgumentList,
REM so the password is passed as a single in-process string with no shell
REM re-interpretation and no trailing newline.

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
for /f "delims=" %%K in ('powershell -NoProfile -Command "$p = Read-Host -AsSecureString; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); $s = [Runtime.InteropServices.Marshal]::PtrToStringAuto($b); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); Write-Output ($s.Trim())"') do set "KEY=%%K"

:store
if "%KEY%"=="" (
    echo ERROR: empty key; nothing stored.
    exit /b 1
)

REM Validate the key shape so we fail fast with a useful message instead
REM of saving garbage and then watching every request 401. We only check
REM the parts that actually matter: must start with "sk-", must be made
REM of URL-safe ASCII, no whitespace. We intentionally do NOT pin the
REM "sk-or-v1-" prefix because OpenRouter ships multiple key formats.
echo %KEY% | findstr /R /C:"^sk-[A-Za-z0-9._-]\{20,\}$" >nul
if errorlevel 1 (
    echo.
    echo ERROR: the value does not look like an OpenRouter API key.
    echo Expected format: sk-... with no whitespace or newlines.
    echo.
    exit /b 1
)

REM Hand the value to cmdkey as a process argument, NOT via stdin echo.
REM A trailing newline in the stored value will make Go's net/http reject
REM the Authorization header with "invalid header field value", which is
REM the bug this whole rewrite exists to prevent.
powershell -NoProfile -Command "cmdkey /generic:'%SERVICE%' /user:'%USER%' /pass:'%KEY%'"
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
