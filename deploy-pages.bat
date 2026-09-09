@echo off
setlocal enabledelayedexpansion
title Deploy to GitHub Pages (sneed-and-feed.github.io)

cd /d "%~dp0"

echo ====================================================================
echo   BRAUN AS 42 - DEPLOY TO GITHUB PAGES (sneed-and-feed.github.io)
echo ====================================================================
echo.

set "TARGET_DIR=%~dp0..\sneed-and-feed.github.io"

:: Check if sneed-and-feed.github.io clone exists
if not exist "%TARGET_DIR%\.git" (
    echo [INFO] Local clone not found at "%TARGET_DIR%".
    echo Cloning https://github.com/sneed-and-feed/sneed-and-feed.github.io.git ...
    git clone https://github.com/sneed-and-feed/sneed-and-feed.github.io.git "%TARGET_DIR%"
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to clone repository.
        pause
        exit /b 1
    )
)

echo [1/4] Pulling latest changes in sneed-and-feed.github.io ...
cd /d "%TARGET_DIR%"
git pull origin main

echo [2/4] Syncing assets from audio-engineering ...
cd /d "%~dp0"

copy /y "index.html" "%TARGET_DIR%\" >nul
copy /y ".nojekyll" "%TARGET_DIR%\" >nul
copy /y "README.md" "%TARGET_DIR%\" >nul
copy /y "package.json" "%TARGET_DIR%\" >nul
copy /y "server.js" "%TARGET_DIR%\" >nul
copy /y "start.bat" "%TARGET_DIR%\" >nul
copy /y "run.bat" "%TARGET_DIR%\" >nul

robocopy "css" "%TARGET_DIR%\css" /E /NFL /NDL /NJH /NJS >nul
robocopy "js" "%TARGET_DIR%\js" /E /NFL /NDL /NJH /NJS >nul

echo [3/4] Checking git status ...
cd /d "%TARGET_DIR%"
git status --short

git add index.html .nojekyll README.md package.json server.js start.bat run.bat css js
git diff --cached --quiet
if !errorlevel! equ 0 (
    echo [INFO] No changes to deploy - sneed-and-feed.github.io is already up-to-date!
    goto done
)

echo [4/4] Committing and pushing to GitHub Pages ...
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set timestamp=!datetime:~0,4!-!datetime:~4,2!-!datetime:~6,2! !datetime:~8,2!:!datetime:~10,2!
git commit -m "deploy: update Braun AS 42 synthesizer build (%timestamp%)"
git push origin main

if !errorlevel! equ 0 (
    echo.
    echo ====================================================================
    echo   DEPLOY SUCCESSFUL!
    echo   Your synthesizer is live at: https://sneed-and-feed.github.io/
    echo ====================================================================
) else (
    echo.
    echo [ERROR] git push failed. Please verify git permissions or network connection.
)

:done
echo.
pause
endlocal
