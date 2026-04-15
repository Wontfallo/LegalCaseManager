@echo off
setlocal

set "BACKEND_PORT=8090"
set "FRONTEND_PORT=3001"

echo.
echo  ============================================================
echo   Legal Case Manager - Stop
echo  ============================================================
echo.

for %%P in (%BACKEND_PORT% %FRONTEND_PORT%) do (
    for /f "tokens=5" %%I in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
        echo  Stopping PID %%I on port %%P ...
        taskkill /F /T /PID %%I >nul 2>&1
    )
)

timeout /t 1 /nobreak >nul

echo  Done.
echo.
exit /b 0
