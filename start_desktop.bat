@echo off
chcp 65001 >nul
cd /d "%~dp0"

call tools\ensure_python.bat
if errorlevel 1 (
    pause
    exit /b 1
)

"%PYTHON_EXE%" -c "import webview" >nul 2>nul
if errorlevel 1 (
    echo Installing desktop dependencies...
    "%PYTHON_EXE%" -m pip install -r requirements-desktop.txt
    if errorlevel 1 (
        echo Failed to install dependencies.
        echo Check your network connection, then run start_desktop.bat again.
        pause
        exit /b 1
    )
)

"%PYTHON_EXE%" app\desktop.py
pause
exit /b %errorlevel%
