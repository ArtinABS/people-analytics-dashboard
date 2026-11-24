from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent
DEFAULT_WORKBOOK = REPO_DIR.parent / "Given Files" / "PA Task.xlsx"
DEFAULT_DATABASE = BACKEND_DIR / "data" / "employees.sqlite3"
