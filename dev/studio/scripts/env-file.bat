@echo off
REM Create .ai-creative-studio.env one directory above the repo and store
REM your OpenRouter API key in it. This is the recommended way to provide
REM the key to the studio.
REM
REM Usage:
REM   env-file                       prompts for the key (input is hidden)
REM   env-file sk-or-v1-...          stores the key from the first arg
REM
REM The .env file lives at: <parent-of-repo>\.ai-creative-studio.env
REM For the bundled repo that is c:\custom\projects\.ai-creative-studio.env
REM
REM Re-run this script any time you want to update the key. The server
REM reads the file on each launch, so just restart studio.exe afterwards.

setlocal

REM Walk up from this script's directory until we find the repo root
REM (a directory containing go.mod). The .env file goes in its parent.
set "CANDIDATE_DIR=%~dp0"
:find_repo
if "%CANDIDATE_DIR:~-1%"=="\" set CANDIDATE_DIR=%CANDIDATE_DIR:~0,-1%
if exist "%CANDIDATE_DIR%\go.mod" goto :found_repo
for %%P in ("%CANDIDATE_DIR%") do set "CANDIDATE_DIR=%%~dpP"
if "%CANDIDATE_DIR%"=="" goto :not_found
if "%CANDIDATE_DIR:~-1%"=="\" set CANDIDATE_DIR=%CANDIDATE_DIR:~0,-1%
if "%CANDIDATE_DIR%"=="%SystemDrive%\" goto :not_found
goto :find_repo

:found_repo
for %%P in ("%CANDIDATE_DIR%") do set "PARENT_DIR=%%~dpP"
REM Strip the trailing backslash that %%~dpP leaves.
if "%PARENT_DIR:~-1%"=="\" set PARENT_DIR=%PARENT_DIR:~0,-1%
set "ENV_FILE=%PARENT_DIR%\.ai-creative-studio.env"
goto :prompt

:not_found
echo ERROR: could not find a go.mod in any parent directory.
echo        Run this script from inside the ai_creative_studio repo.
exit /b 1

:prompt
if "%~1"=="" goto :ask
set "KEY=%~1"
goto :write

:ask
echo Enter your OpenRouter API key (input is hidden):
for /f "delims=" %%K in ('powershell -NoProfile -Command "$p = Read-Host -AsSecureString; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); $s = [Runtime.InteropServices.Marshal]::PtrToStringAuto($b); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); Write-Output $s"') do set "KEY=%%K"

:write
if "%KEY%"=="" (
    echo ERROR: empty key; nothing stored.
    exit /b 1
)

REM Validate the key shape. Reject anything that doesn't look like a real
REM OpenRouter key so we fail fast instead of saving garbage.
echo %KEY% | findstr /R /C:"^sk-[A-Za-z0-9._-]\{20,\}$" >nul
if errorlevel 1 (
    echo.
    echo ERROR: the value does not look like an OpenRouter API key.
    echo Expected format: sk-... with no whitespace or newlines.
    exit /b 1
)

(
    echo # Creative Studio — OpenRouter API key
    echo # Created by scripts\env-file.bat
    echo OPENROUTER_API_KEY=%KEY%
) > "%ENV_FILE%"

if errorlevel 1 (
    echo ERROR: could not write %ENV_FILE%
    exit /b 1
)

echo.
echo Wrote API key to: %ENV_FILE%
echo.
echo Restart studio.exe (or run start-studio.bat) and the server will pick it up.
endlocal
