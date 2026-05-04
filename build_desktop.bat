@echo off
chcp 65001 >nul
cd /d "%~dp0"

call tools\ensure_python.bat
if errorlevel 1 (
    pause
    exit /b 1
)

echo Installing build dependencies...
"%PYTHON_EXE%" -m pip install -r requirements-desktop.txt
if errorlevel 1 (
    echo Failed to install build dependencies.
    echo Check your network connection, then run build_desktop.bat again.
    pause
    exit /b 1
)

echo Building desktop app...
"%PYTHON_EXE%" -m PyInstaller --noconfirm --clean classroom_desktop.spec
if errorlevel 1 (
    echo Build failed.
    echo Review the PyInstaller output above, then run build_desktop.bat again.
    pause
    exit /b 1
)

echo Done. Open dist\24美术2班常规管理系统\24美术2班常规管理系统.exe
pause
exit /b 0
