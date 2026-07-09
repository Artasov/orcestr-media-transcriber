@echo off
setlocal

set "ROOT=%~dp0"
set "APP_URL=http://127.0.0.1:8933"

cd /d "%ROOT%"

echo Orcestr Media Transcriber
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo Python 3.12 is required and was not found in PATH.
    echo Install Python 3.12, then run this file again.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js 20+ is required and was not found in PATH.
    echo Install Node.js 20+, then run this file again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm is required and was not found in PATH.
    echo Install Node.js with npm, then run this file again.
    pause
    exit /b 1
)

where uv >nul 2>nul
if errorlevel 1 (
    echo uv is required and was not found in PATH.
    echo Install uv, then run this file again.
    pause
    exit /b 1
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
    echo ffmpeg is required and was not found in PATH.
    echo Install ffmpeg, then run this file again.
    pause
    exit /b 1
)

where ffprobe >nul 2>nul
if errorlevel 1 (
    echo ffprobe is required and was not found in PATH.
    echo Install ffmpeg with ffprobe, then run this file again.
    pause
    exit /b 1
)

if not exist "%ROOT%.env" (
    copy "%ROOT%.env.example" "%ROOT%.env" >nul
)

if not exist "%ROOT%backend\.venv\Scripts\python.exe" (
    echo Installing backend dependencies...
    pushd "%ROOT%backend"
    call uv sync
    if errorlevel 1 (
        popd
        echo Backend dependency installation failed.
        pause
        exit /b 1
    )
    popd
)

if not exist "%ROOT%frontend\node_modules" (
    echo Installing frontend dependencies...
    pushd "%ROOT%frontend"
    call npm install
    if errorlevel 1 (
        popd
        echo Frontend dependency installation failed.
        pause
        exit /b 1
    )
    popd
)

echo Starting backend...
start "Orcestr Media Backend" cmd /k "cd /d ""%ROOT%backend"" && uv run uvicorn media_transcriber.main:app --app-dir src --host 127.0.0.1 --port 3933"

echo Starting frontend...
start "Orcestr Media Frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm run dev"

echo Opening browser...
timeout /t 3 /nobreak >nul
start "" "%APP_URL%"

echo.
echo App URL: %APP_URL%
echo Close the backend and frontend terminal windows to stop the app.
pause
