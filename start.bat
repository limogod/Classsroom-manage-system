@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动 24美术2班常规管理系统...

call tools\ensure_python.bat
if errorlevel 1 (
    pause
    exit /b 1
)

"%PYTHON_EXE%" app\server.py
pause
exit /b %errorlevel%
