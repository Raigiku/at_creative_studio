@echo off
REM Show which credential source the server will use on next start, without
REM exposing the key itself. Pure stdlib \226 no native tool required.

setlocal EnableDelayedExpansion
echo Credential lookup order:
if defined OPENROUTER_API_KEY (
    echo   1. OPENROUTER_API_KEY env var    : set
    set ENV_SET=1
) else (
    echo   1. OPENROUTER_API_KEY env var    : not set
    set ENV_SET=0
)
cmdkey /list:creative-studio >nul 2>&1
if not errorlevel 1 (
    echo   2. Windows Credential Manager     : set ^(Target=creative-studio, User=openrouter-api-key^)
    set KR_SET=1
) else (
    echo   2. Windows Credential Manager     : not set
    set KR_SET=0
)
if "!ENV_SET!"=="0" if "!KR_SET!"=="0" (
    echo   --^> No key found. The server will refuse to start.
    echo   --^> Run scripts\set-key.bat to store one.
)
if "!ENV_SET!"=="1" (
    echo   --^> Server will use: env var ^(overrides credential manager^).
) else if "!KR_SET!"=="1" (
    echo   --^> Server will use: Windows Credential Manager.
)
endlocal
