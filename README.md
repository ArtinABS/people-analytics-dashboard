# SnappFood People Analytics Dashboard

An interactive dashboard for the 2025 People Analytics case study. The app imports six Excel worksheets into SQLite, serves the data through FastAPI, and displays it in a Next.js dashboard.

## Run locally

1. Install Python 3.11+ and Node.js 20.9+.
2. Put the supplied `PA Task.xlsx` at `Interview Task/Given Files/PA Task.xlsx`. Create the `Given Files` folder if needed.
3. Open this repository folder in VS Code and press **Ctrl+Shift+B**. The task imports the workbook and opens separate terminals for the database, API, and frontend.
4. Open the [dashboard](http://127.0.0.1:3000) and [interactive API docs](http://127.0.0.1:8000/docs).

The workbook and presentation PDF are separate from the source repository. The importer creates the local SQLite database from the workbook.

The [dashboard README](<Interview Task/Employees Dashboard/README.md>) covers manual setup, the API, reproducing the presentation calculations, and running the Python and browser tests.
