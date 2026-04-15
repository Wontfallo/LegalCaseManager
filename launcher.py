"""
LegalCM – System Tray Launcher
Runs the backend (FastAPI) and frontend (Next.js) as hidden background
processes, managed from a single system-tray icon.

Usage:
    pythonw.exe launcher.py          # no console window at all
    python.exe  launcher.py          # with a console (for debugging)
"""

from __future__ import annotations

import atexit
import logging
import os
import signal
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import pystray
from PIL import Image, ImageDraw, ImageFont

# ── Paths ────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV_PYTHON = BACKEND / ".venv" / "Scripts" / "python.exe"
NPM = "npm"

BACKEND_PORT = 8090
FRONTEND_PORT = 3001
POLL_INTERVAL = 2  # seconds

LOG_FILE = ROOT / "logs" / "launcher.log"
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    filename=str(LOG_FILE),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("launcher")

# ── State ────────────────────────────────────────────────

class AppState:
    def __init__(self):
        self.backend_proc: subprocess.Popen | None = None
        self.frontend_proc: subprocess.Popen | None = None
        self.icon: pystray.Icon | None = None
        self._stopping = False

    @property
    def backend_alive(self) -> bool:
        return self.backend_proc is not None and self.backend_proc.poll() is None

    @property
    def frontend_alive(self) -> bool:
        return self.frontend_proc is not None and self.frontend_proc.poll() is None

    @property
    def status(self) -> str:
        if self.backend_alive and self.frontend_alive:
            return "running"
        if self.backend_alive or self.frontend_alive:
            return "partial"
        return "stopped"


state = AppState()


# ── Icon Drawing ─────────────────────────────────────────

def _create_icon_image(color: str = "#8251EE") -> Image.Image:
    """Draw a simple colored circle with 'LC' text as the tray icon."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([2, 2, size - 2, size - 2], fill=color)
    try:
        font = ImageFont.truetype("arial.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "LC", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2 - 2), "LC", fill="white", font=font)
    return img


ICON_RUNNING = _create_icon_image("#22c55e")   # green
ICON_PARTIAL = _create_icon_image("#eab308")   # yellow
ICON_STOPPED = _create_icon_image("#8251EE")   # purple (brand)


def _update_icon():
    """Update the tray icon based on current state."""
    if state.icon is None:
        return
    s = state.status
    if s == "running":
        state.icon.icon = ICON_RUNNING
        state.icon.title = f"LegalCM  ●  Running\nBackend :  localhost:{BACKEND_PORT}\nFrontend: localhost:{FRONTEND_PORT}"
    elif s == "partial":
        be = "✓" if state.backend_alive else "✗"
        fe = "✓" if state.frontend_alive else "✗"
        state.icon.icon = ICON_PARTIAL
        state.icon.title = f"LegalCM  ◐  Partial\nBackend {be}  |  Frontend {fe}"
    else:
        state.icon.icon = ICON_STOPPED
        state.icon.title = "LegalCM  ○  Stopped"


# ── Process Management ───────────────────────────────────

CREATE_NO_WINDOW = 0x08000000  # Windows flag to hide console

def _start_backend():
    if state.backend_alive:
        log.info("Backend already running (pid %d)", state.backend_proc.pid)
        return
    log.info("Starting backend on port %d", BACKEND_PORT)
    env = os.environ.copy()
    state.backend_proc = subprocess.Popen(
        [
            str(VENV_PYTHON), "-m", "uvicorn",
            "app.main:app",
            "--host", "0.0.0.0",
            "--port", str(BACKEND_PORT),
            "--reload",
        ],
        cwd=str(BACKEND),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=open(str(ROOT / "logs" / "backend.log"), "a"),
        creationflags=CREATE_NO_WINDOW,
    )
    log.info("Backend started (pid %d)", state.backend_proc.pid)


def _start_frontend():
    if state.frontend_alive:
        log.info("Frontend already running (pid %d)", state.frontend_proc.pid)
        return
    log.info("Starting frontend on port %d", FRONTEND_PORT)
    env = os.environ.copy()
    env["PORT"] = str(FRONTEND_PORT)
    env["NEXT_PUBLIC_API_URL"] = f"http://localhost:{BACKEND_PORT}"
    state.frontend_proc = subprocess.Popen(
        [NPM, "run", "dev"],
        cwd=str(FRONTEND),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=open(str(ROOT / "logs" / "frontend.log"), "a"),
        creationflags=CREATE_NO_WINDOW,
        shell=True,
    )
    log.info("Frontend started (pid %d)", state.frontend_proc.pid)


def _kill_proc(proc: subprocess.Popen | None, name: str):
    if proc is None or proc.poll() is not None:
        return
    log.info("Stopping %s (pid %d)", name, proc.pid)
    try:
        # Kill process tree on Windows
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _stop_all():
    state._stopping = True
    _kill_proc(state.backend_proc, "backend")
    _kill_proc(state.frontend_proc, "frontend")
    state.backend_proc = None
    state.frontend_proc = None
    state._stopping = False
    log.info("All processes stopped")


def _restart_all():
    _stop_all()
    time.sleep(1)
    _start_backend()
    time.sleep(3)
    _start_frontend()
    _update_icon()


# ── Watchdog Thread ──────────────────────────────────────

def _watchdog():
    """Periodically update the icon to reflect process health."""
    while True:
        time.sleep(POLL_INTERVAL)
        if state._stopping:
            continue
        _update_icon()


# ── Menu Actions ─────────────────────────────────────────

def on_open_app(icon, item):
    webbrowser.open(f"http://localhost:{FRONTEND_PORT}")

def on_open_api_docs(icon, item):
    webbrowser.open(f"http://localhost:{BACKEND_PORT}/api/docs")

def on_start(icon, item):
    threading.Thread(target=_do_start, daemon=True).start()

def _do_start():
    _start_backend()
    time.sleep(3)
    _start_frontend()
    _update_icon()

def on_stop(icon, item):
    threading.Thread(target=_do_stop, daemon=True).start()

def _do_stop():
    _stop_all()
    _update_icon()

def on_restart(icon, item):
    threading.Thread(target=_restart_all, daemon=True).start()

def on_quit(icon, item):
    log.info("Quit requested")
    _stop_all()
    icon.stop()


# ── Menu Builder ─────────────────────────────────────────

def _build_menu():
    return pystray.Menu(
        pystray.MenuItem(
            "Open LegalCM",
            on_open_app,
            default=True,  # double-click action
        ),
        pystray.MenuItem("API Docs", on_open_api_docs),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Start", on_start),
        pystray.MenuItem("Stop", on_stop),
        pystray.MenuItem("Restart", on_restart),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit", on_quit),
    )


# ── Entry Point ──────────────────────────────────────────

def main():
    log.info("=== LegalCM Launcher starting ===")

    # Ensure .env.local for frontend
    env_local = FRONTEND / ".env.local"
    env_local.write_text(
        f"NEXT_PUBLIC_API_URL=http://localhost:{BACKEND_PORT}\n",
        encoding="utf-8",
    )

    # Start services
    _start_backend()
    time.sleep(3)
    _start_frontend()

    # Watchdog thread
    watcher = threading.Thread(target=_watchdog, daemon=True)
    watcher.start()

    # Cleanup on exit
    atexit.register(_stop_all)

    # Create and run the tray icon (blocks on this thread)
    state.icon = pystray.Icon(
        name="LegalCM",
        icon=ICON_RUNNING,
        title=f"LegalCM  ●  Starting...",
        menu=_build_menu(),
    )
    log.info("Tray icon running")

    # Open browser after a short delay
    def _delayed_open():
        time.sleep(6)
        webbrowser.open(f"http://localhost:{FRONTEND_PORT}")
    threading.Thread(target=_delayed_open, daemon=True).start()

    state.icon.run()  # blocks until Quit

    log.info("=== LegalCM Launcher exited ===")


if __name__ == "__main__":
    main()
