@echo off
title CyberFace Local Development Runner
echo ===================================================
echo   CyberFace ^| Real-Time Face Recognition Launcher
echo ===================================================
echo.

:: Check Node.js installation
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

:: Navigate to project directory
cd /d "%~dp0"

:: Check node_modules
if not exist "node_modules\" (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

:: Check if models are downloaded
if not exist "public\models\face_recognition_model-shard1" (
    echo [INFO] AI Models not found. Downloading weights...
    call node download-models.js
    if %errorlevel% neq 0 (
        echo [ERROR] Model download failed.
        pause
        exit /b 1
    )
)

echo.
echo [SUCCESS] Everything is set up!
echo [INFO] Starting Next.js development server at http://localhost:3000...
echo.
call npm run dev
