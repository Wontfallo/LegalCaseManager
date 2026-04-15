@echo off
title LegalCM Backend
cd /d "C:\Users\WontML\dev\Project\backend"
"C:\Users\WontML\dev\Project\backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir "C:\Users\WontML\dev\Project\backend" --host 0.0.0.0 --port 8090 --reload
pause
