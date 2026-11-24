import argparse
import hashlib
import os
import socket
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen


PROJECT_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
VENV_BIN = "Scripts/python.exe" if os.name == "nt" else "bin/python"
VENV_PYTHON = PROJECT_DIR / ".venv" / VENV_BIN
NPM = "npm.cmd" if os.name == "nt" else "npm"


def reuse_server(name, port, check_path, markers, *, required_features=()):
    with socket.socket() as listener:
        listener.settimeout(0.4)
        if listener.connect_ex(("127.0.0.1", port)) != 0:
            return False

    url = f"http://127.0.0.1:{port}"
    try:
        with urlopen(url + check_path, timeout=8) as response:
            body = response.read()
    except OSError:
        body = b""
    if all(marker in body for marker in markers):
        if any(feature not in body for feature in required_features):
            raise SystemExit(f"Restart the running {name} task to load the dashboard's current API.")
        print(f"{name} is already running at {url}.")
        return True

    raise SystemExit(f"Port {port} is in use. Stop the existing process before starting {name}.")


def prepare_database():
    if not VENV_PYTHON.is_file():
        print("Creating the dashboard's Python environment.")
        subprocess.run([sys.executable, "-m", "venv", ".venv"], cwd=PROJECT_DIR, check=True)

    print("Checking Python dependencies.")
    subprocess.run(
        [VENV_PYTHON, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r", "requirements.txt"],
        cwd=PROJECT_DIR,
        check=True,
    )
    subprocess.run([VENV_PYTHON, "import_employees.py"], cwd=PROJECT_DIR, check=True)


def run_backend():
    if reuse_server(
        "FastAPI",
        8000,
        "/openapi.json",
        (b"Employees Dashboard API", b"application/x-ndjson"),
        required_features=(
            b'"/employees/filters"',
            b'"/employees/{employee_id}"',
            b'"hire_date_from"',
            b'"date_of_birth_from"',
            b'"/monthly-employees/options"',
            b'"/attrition-events"',
            b'"exit_date_from"',
            b'"exit_date_to"',
            b'"/engagement-surveys"',
            b'"/performance-reviews"',
            b'"/recruitment"',
            b'"/advanced-analysis"',
        ),
    ):
        return
    subprocess.run(
        [VENV_PYTHON, "-m", "uvicorn", "api:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=PROJECT_DIR,
        check=True,
    )


def run_frontend():
    if reuse_server("Next.js", 3000, "/", (b"<title>Employees | People Analytics</title>",)):
        return

    manifest = (FRONTEND_DIR / "package.json").read_bytes()
    lockfile = (FRONTEND_DIR / "package-lock.json").read_bytes()
    dependency_hash = hashlib.sha256(manifest + lockfile).hexdigest()
    node_modules = FRONTEND_DIR / "node_modules"
    install_marker = node_modules / ".employees-dashboard-lock"
    if (
        not install_marker.is_file()
        or install_marker.read_text(encoding="utf-8") != dependency_hash
        or not (node_modules / "next" / "package.json").is_file()
    ):
        subprocess.run([NPM, "ci"], cwd=FRONTEND_DIR, check=True)
        install_marker.write_text(dependency_hash, encoding="utf-8")

    subprocess.run([NPM, "run", "dev", "--", "--port", "3000"], cwd=FRONTEND_DIR, check=True)


if __name__ == "__main__":
    actions = {"database": prepare_database, "backend": run_backend, "frontend": run_frontend}
    parser = argparse.ArgumentParser(description="Run a dashboard terminal task.")
    parser.add_argument("task", choices=actions)
    task = parser.parse_args().task
    try:
        actions[task]()
    except KeyboardInterrupt:
        pass
    except (OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Dashboard {task} task failed: {error}") from error
