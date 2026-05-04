@echo off
set "PYTHON_VERSION=3.12.10"
set "PYTHON_URL=https://www.python.org/ftp/python/%PYTHON_VERSION%/python-%PYTHON_VERSION%-amd64.exe"
set "TOOLS_DIR=%~dp0"
set "INSTALLER_PATH=%TOOLS_DIR%python-%PYTHON_VERSION%-amd64.exe"
set "PYTHON_EXE="

call :try_command python
if defined PYTHON_EXE exit /b 0

call :try_command "py -3.12"
if defined PYTHON_EXE exit /b 0

call :try_command "py -3"
if defined PYTHON_EXE exit /b 0

call :try_file "%LocalAppData%\Programs\Python\Python312\python.exe"
if defined PYTHON_EXE exit /b 0

echo Python was not found. Downloading Python %PYTHON_VERSION%...
if not exist "%INSTALLER_PATH%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile '%INSTALLER_PATH%' -UseBasicParsing } catch { Write-Host $_.Exception.Message; exit 1 }"
    if errorlevel 1 (
        echo Failed to download Python.
        echo Please download and install Python manually from:
        echo %PYTHON_URL%
        exit /b 1
    )
)

echo Installing Python %PYTHON_VERSION% for the current user...
"%INSTALLER_PATH%" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_launcher=1 Include_test=0 SimpleInstall=1
set "INSTALL_EXIT=%ERRORLEVEL%"

call :try_file "%LocalAppData%\Programs\Python\Python312\python.exe"
if defined PYTHON_EXE exit /b 0

call :try_command "py -3.12"
if defined PYTHON_EXE exit /b 0

call :try_command python
if defined PYTHON_EXE exit /b 0

if not "%INSTALL_EXIT%"=="0" (
    echo Python installer returned exit code %INSTALL_EXIT%.
    echo Please run this installer manually:
    echo %INSTALLER_PATH%
    exit /b 1
)

echo Python was installed, but this script could not find python.exe.
echo Close this window and run the script again. If it still fails, restart Windows.
exit /b 1

:try_command
%~1 --version >nul 2>nul
if not errorlevel 1 (
    for /f "delims=" %%P in ('%~1 -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON_EXE=%%P"
    if defined PYTHON_EXE exit /b 0
)
exit /b 1

:try_file
if exist "%~1" (
    "%~1" --version >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON_EXE=%~1"
        exit /b 0
    )
)
exit /b 1
