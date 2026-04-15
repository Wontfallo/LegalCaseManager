@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  Legal Case Manager – One-Click Start Script
::  Runs the backend (FastAPI) and frontend (Next.js) locally
::  using SQLite (no Docker/Postgres/Redis required).
:: ============================================================

title Legal Case Manager – Startup

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "VENV=%BACKEND%\.venv"
set "LOGDIR=%ROOT%logs"
set "BACKEND_LAUNCHER=%ROOT%launch-backend.cmd"
set "FRONTEND_LAUNCHER=%ROOT%launch-frontend.cmd"
set "BACKEND_PORT=8090"
set "FRONTEND_PORT=3001"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "PIP_LOG=%LOGDIR%\pip-install.log"
set "NPM_LOG=%LOGDIR%\npm-install.log"
if exist "%PIP_LOG%" del /f /q "%PIP_LOG%" >nul 2>&1
if exist "%NPM_LOG%" del /f /q "%NPM_LOG%" >nul 2>&1
if exist "%BACKEND_LAUNCHER%" del /f /q "%BACKEND_LAUNCHER%" >nul 2>&1
if exist "%FRONTEND_LAUNCHER%" del /f /q "%FRONTEND_LAUNCHER%" >nul 2>&1

echo.
echo  ============================================================
echo   Legal Case Manager – One-Click Startup
echo  ============================================================
echo.
echo  Logs will be written to:
echo    %LOGDIR%
echo.

:: ────────────────────────────────────────────────────────────
::  1. Preflight checks
:: ────────────────────────────────────────────────────────────

echo [1/6] Checking prerequisites...

:: Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Python is not installed or not on PATH.
    echo         Install Python 3.11+ from https://www.python.org/downloads/
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do set "PYVER=%%v"
echo        Python ........... %PYVER%

:: Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not installed or not on PATH.
    echo         Install Node.js 18+ from https://nodejs.org/
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>^&1') do set "NODEVER=%%v"
echo        Node.js .......... %NODEVER%

:: npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: npm is not installed or not on PATH.
    exit /b 1
)
for /f "tokens=*" %%v in ('npm --version 2^>^&1') do set "NPMVER=%%v"
echo        npm .............. v%NPMVER%

:: Tesseract OCR (required for document processing)
where tesseract >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  WARNING: Tesseract OCR is not installed or not on PATH.
    echo           Document OCR processing will fail without it.
    echo.
    echo           Install from: https://github.com/UB-Mannheim/tesseract/wiki
    echo           After install, add to PATH or set TESSERACT_CMD in .env
    echo.
    echo           The app will still start, but document uploads will show 'Failed'.
    echo.
) else (
    for /f "tokens=*" %%v in ('tesseract --version 2^>^&1') do (
        echo        Tesseract ........ %%v
        goto :tess_done
    )
)
:tess_done

echo        All prerequisites found.
echo.

:: Port conflicts
for %%P in (%BACKEND_PORT% %FRONTEND_PORT%) do (
    netstat -ano | findstr /r /c:":%%P .*LISTENING" >nul 2>&1
    if !errorlevel! equ 0 (
        echo  ERROR: Port %%P is already in use.
        echo         Close the existing process using port %%P, then run start.bat again.
        echo         Helpful command: netstat -ano ^| findstr :%%P
        echo.
        exit /b 1
    )
)

:: ────────────────────────────────────────────────────────────
::  2. Backend – Python virtual environment
:: ────────────────────────────────────────────────────────────

echo [2/6] Setting up Python virtual environment...

if not exist "%VENV%\Scripts\activate.bat" (
    echo        Creating venv at %VENV% ...
    python -m venv "%VENV%"
    if %errorlevel% neq 0 (
        echo  ERROR: Failed to create virtual environment.
        exit /b 1
    )
    echo        venv created.
) else (
    echo        venv already exists. Reusing.
)

call "%VENV%\Scripts\activate.bat"
echo.

:: ────────────────────────────────────────────────────────────
::  3. Backend – Install Python dependencies
:: ────────────────────────────────────────────────────────────

echo [3/6] Installing Python dependencies...

:: Use a stamp file to skip reinstall on subsequent runs
set "STAMP=%VENV%\.deps_installed"
if exist "%STAMP%" (
    echo        Dependencies already installed. Skipping.
    echo        (Delete %STAMP% to force reinstall)
) else (
    echo        Installing Python packages. This may take a few minutes...
    echo        Full log: %PIP_LOG%
    call pip install --upgrade pip >> "%PIP_LOG%" 2>&1
    call pip install -r "%BACKEND%\requirements.txt" >> "%PIP_LOG%" 2>&1
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: pip install failed.
        echo  Review this log for details:
        echo    %PIP_LOG%
        echo.
        type "%PIP_LOG%"
        exit /b 1
    )
    echo.> "%STAMP%"
    echo        Dependencies installed.
)
echo.

:: ────────────────────────────────────────────────────────────
::  4. Backend – Create .env if missing (SQLite local mode)
:: ────────────────────────────────────────────────────────────

echo [4/6] Checking backend .env configuration...

if not exist "%BACKEND%\.env" (
    echo        No .env found. Creating local-dev config with SQLite...

    :: Generate a random JWT secret
    for /f "tokens=*" %%k in ('python -c "import secrets; print(secrets.token_urlsafe(48))"') do set "JWT_SECRET=%%k"

    (
        echo # Auto-generated by start.bat – Local Development Mode
        echo APP_ENV=development
        echo APP_DEBUG=true
        echo APP_HOST=0.0.0.0
        echo APP_PORT=%BACKEND_PORT%
        echo LOG_LEVEL=INFO
        echo.
        echo # SQLite local-first database (no Postgres needed^)
        echo DATABASE_URL=sqlite+aiosqlite:///./storage/legalcm.db
        echo.
        echo # JWT – auto-generated secret
        echo JWT_SECRET_KEY=!JWT_SECRET!
        echo JWT_ALGORITHM=HS256
        echo JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
        echo JWT_REFRESH_TOKEN_EXPIRE_MINUTES=10080
        echo.
        echo # Encryption
        echo FILE_ENCRYPTION_KEY=localdev_00000000000000000000000
        echo.
        echo # AI keys – fill these in to enable OCR/NLP features
        echo OPENAI_API_KEY=
        echo MISTRAL_API_KEY=
        echo.
        echo # ChromaDB – local persistent mode (no Docker needed^)
        echo CHROMA_HOST=localhost
        echo CHROMA_PORT=8000
        echo CHROMA_COLLECTION=legal_documents
        echo.
        echo # File storage
        echo UPLOAD_DIR=./storage/uploads
        echo MAX_UPLOAD_SIZE_MB=50
    ) > "%BACKEND%\.env"

    echo        .env created with SQLite and auto-generated JWT secret.
    echo.
    echo  ╔════════════════════════════════════════════════════════╗
    echo  ║  TIP: To enable AI features, edit backend\.env and    ║
    echo  ║  add your OPENAI_API_KEY and/or MISTRAL_API_KEY.      ║
    echo  ╚════════════════════════════════════════════════════════╝
    echo.
) else (
    echo        .env already exists. Using existing config.
)

:: Ensure storage directories exist
if not exist "%BACKEND%\storage\uploads" mkdir "%BACKEND%\storage\uploads"
echo.

:: ────────────────────────────────────────────────────────────
::  5. Frontend – Install Node dependencies
:: ────────────────────────────────────────────────────────────

echo [5/6] Installing frontend dependencies...

if exist "%FRONTEND%\node_modules" (
    echo        node_modules already exists. Skipping.
    echo        (Delete frontend\node_modules to force reinstall)
) else (
    cd /d "%FRONTEND%"
    echo        Installing frontend packages. This may take a few minutes...
    echo        Full log: %NPM_LOG%
    call npm install >> "%NPM_LOG%" 2>&1
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: npm install failed.
        echo  Review this log for details:
        echo    %NPM_LOG%
        echo.
        type "%NPM_LOG%"
        exit /b 1
    )
    echo        Frontend dependencies installed.
)

:: Create .env.local if missing
> "%FRONTEND%\.env.local" echo NEXT_PUBLIC_API_URL=http://localhost:%BACKEND_PORT%
echo        Set frontend .env.local to local backend port %BACKEND_PORT%
echo.

:: ────────────────────────────────────────────────────────────
::  6. Launch both servers
:: ────────────────────────────────────────────────────────────

echo [6/6] Starting servers...
echo.
echo  ┌──────────────────────────────────────────────────────┐
echo  │  Backend  (FastAPI)  →  http://localhost:%BACKEND_PORT%        │
echo  │  API Docs (Swagger)  →  http://localhost:%BACKEND_PORT%/api/docs│
echo  │  Frontend (Next.js)  →  http://localhost:%FRONTEND_PORT%        │
echo  └──────────────────────────────────────────────────────┘
echo.
echo  Press Ctrl+C in either window to stop that server.
echo.

(
    echo @echo off
    echo title LegalCM Backend
    echo cd /d "%BACKEND%"
    echo "%VENV%\Scripts\python.exe" -m uvicorn app.main:app --app-dir "%BACKEND%" --host 0.0.0.0 --port %BACKEND_PORT% --reload
    echo pause
) > "%BACKEND_LAUNCHER%"

(
    echo @echo off
    echo title LegalCM Frontend
    echo cd /d "%FRONTEND%"
    echo set PORT=%FRONTEND_PORT%
    echo npm run dev
    echo pause
) > "%FRONTEND_LAUNCHER%"

:: Start backend in a new window
start "LegalCM Backend" cmd /k "%BACKEND_LAUNCHER%"

:: Give backend a moment to initialise DB before frontend starts fetching
timeout /t 4 /nobreak >nul

:: Start frontend in a new window
start "LegalCM Frontend" cmd /k "%FRONTEND_LAUNCHER%"

:: Wait a beat then open the browser
timeout /t 6 /nobreak >nul
start http://localhost:%FRONTEND_PORT%

echo.
echo  Both servers launched. Browser opening to http://localhost:%FRONTEND_PORT%
echo  Logs:
echo    %PIP_LOG%
echo    %NPM_LOG%
echo  This launcher window can be closed safely after both app windows are up.
echo.
exit /b 0
