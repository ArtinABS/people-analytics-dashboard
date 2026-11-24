# Employees dashboard

A local Next.js and FastAPI dashboard using the `Employees`, `Monthly Employee Data`, `Attrition Events`, `Engagement Surveys`, `Performance Reviews`, and `Recruitment` worksheets in `PA Task.xlsx`.

## Run it locally

Use Python 3.11+ and Node.js 20.9+. Place the supplied workbook at `Interview Task/Given Files/PA Task.xlsx`. In VS Code, open the repository root (the folder containing `.vscode` and `Interview Task`) and press **Ctrl+Shift+B**. The task opens three named terminals.

- **Database** prepares the Python environment, imports the supplied workbook into SQLite, and keeps the import log visible.
- **Backend** starts FastAPI on port 8000 after the import finishes.
- **Frontend** installs Node dependencies when needed and starts Next.js on port 3000 after the import finishes.

Open [the dashboard](http://127.0.0.1:3000) when both servers are ready. If a dashboard server is already running, its task reports the address. Use **Tasks: Terminate Task** to stop servers launched by VS Code.

### Run manually

From the `Employees Dashboard` folder, set up the Python environment, import the workbook, and start FastAPI in PowerShell.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe import_employees.py
.\.venv\Scripts\python.exe -m uvicorn api:app --host 127.0.0.1 --port 8000
```

The importer looks for `../Given Files/PA Task.xlsx` by default. Use `import_employees.py --workbook "C:/path/to/PA Task.xlsx"` with the virtual environment's Python to read a different copy.

In a second terminal, from the same project folder, start Next.js.

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Open [the dashboard](http://127.0.0.1:3000). Use port 3000 for the dashboard and port 8000 for the API. FastAPI's [interactive documentation](http://127.0.0.1:8000/docs) lets you try the endpoint directly.

## Follow one request

1. `import_employees.py` reads the workbook's `Employees` sheet with openpyxl. It saves the roster and latest import details in the same SQLite transaction. The supplied workbook has 360 records.
2. Open **Search employees**, choose **Sales** under **Department**, and click **Search**. The dashboard sends `GET http://127.0.0.1:8000/employees?department=Sales`.
3. FastAPI reads the matching SQLite rows and returns JSON with `total`, `departments`, and `employees`. The Sales filter returns 103 records.
4. Open the floating **DevTools** panel from any worksheet. It shows the last 12 requests made during the current page session, including their URLs, HTTP statuses, and timings. On Overview, **Run search again** repeats the current search.

The browser sees ports 3000 and 8000 as different origins. FastAPI's CORS setting allows the dashboard's local origin to make read requests.

The search supports all nine worksheet columns. Combined filters must all match. Employee ID accepts a prefix and tenure matches an exact value. Hire date and date of birth use inclusive start and end dates. Fill either date to search with just that bound. The query parameters are `hire_date_from`, `hire_date_to`, `date_of_birth_from`, and `date_of_birth_to`. Each takes an ISO date.

`GET /employees/filters` supplies the dropdown choices. The search response contains the six summary columns. Selecting a result calls `GET /employees/{employee_id}` to load all nine fields in the employee drawer.

## Monthly Employee Data

The workbook import also stores monthly records in SQLite, keyed by employee ID and month. The Employee-first tab loads available choices from `GET /monthly-employees/options` and the selected employee's history from `GET /monthly-employees/{employee_id}`. It starts on the latest workbook month and the lowest employee ID with a record in that month.

The summary below the filters shows department, manager ID, and tenure from the employee's latest available record. The latest promotion month and year come from subtracting the promotion offset in that record from its month. Selecting other months for comparison keeps the summary on the latest record.

Select one or more months. When comparing months, hover over a chart point to see its score, salary grade, and employment status. Select a point to update the gauges and the shared detail section. Missing records or scores leave gaps. The gauges and trends use a shared 0–5 display scale and preserve the workbook values.

## Attrition Events

The dashboard loads the full worksheet with `GET /attrition-events` on open. Changing the exit-date range sends `exit_date_from` and `exit_date_to` as ISO dates. SQLite applies both bounds inclusively. The returned records set the denominator for the exit-reason donut and the three bar charts.

Choose slices, legend items, or bars to filter the table in the browser. Multiple exit reasons or exit types match any selected value in that chart. Filters across charts must all match. The rehire and interview bars share their selections with the table dropdowns.

## Engagement Surveys

`GET /engagement-surveys` loads the workbook responses. The bar chart compares average overall satisfaction across departments for the selected survey quarter. Six trend charts plot department averages for the other survey measures across all quarters on a one-to-five scale. Blank scores are excluded from averages.

The Department and Employee ID pickers control the individual timeline. It shows the employee's seven measures through the selected quarter and leaves gaps for missing responses.

## Performance Reviews

`GET /performance-reviews` loads the quarterly review worksheet. Department and manager views show the score distributions and promotion readiness for the selected quarter or all quarters. Score distributions use the number of valid scored reviews as their denominator. Promotion readiness uses all reviews for the group. Across all quarters, one employee can contribute more than one review.

Select an Employee ID to see that employee's performance ratings across the workbook review quarters. The summary uses the latest available review for promotion readiness and estimates the promotion month by subtracting the recorded promotion offset from the review month.

## Recruitment

`GET /recruitment` loads the workbook's recruitment records. Choose a position in its department branch. Each worksheet row counts as one opening. Offers made sums the offer-count field, and acceptance counts use the outcome recorded for each opening.

Average cost per hire and the two 90-day KPIs use hires with a value recorded for that measure. The workbook does not specify a currency, so the dashboard displays costs in the original workbook units. The opening history shows outcomes and values for individual recruitment records.

## Advanced Analysis

Use **Copy keys** above a filtered table or employee history to copy employee IDs, dates, or tab-separated ID and date pairs. Open **Advanced Analysis**, choose up to three worksheets, select columns for each, and paste the keys. Use one key per line and ISO dates such as `2025-12-15` or `2025-12`. Pairs can use a tab or comma.

Date-only input expands to the matching employees. A month matches that calendar month, and a day matches the exact date or its monthly snapshot. Employees and Recruitment let you choose the date field used for matching. The preview keeps repeated records grouped under their source worksheet and includes unmatched inputs. Navigation preserves the builder while the page remains open.

## Reproduce the presentation calculations

After importing the supplied workbook, run this command from the `Employees Dashboard` folder to print the 2025 results as JSON.

```powershell
.\.venv\Scripts\python.exe case_study.py
```

- **Turnover.** Count exits by quarter. The rate for people hired before 2025 uses their monthly rows, including exit months, as the denominator.
- **Pre-exit engagement.** Compare each voluntary leaver with the mean for peers in the same department and tenure band who were still employed at the exit date. Compare the three preceding monthly snapshots or pair the last pre-exit survey with peers from the same survey date. Missing scores are excluded.
- **Early retention.** Follow 2025 hires with valid dates and at least 90 days of observation by year-end. A departure on day 90 counts. Report voluntary exits separately.
- **Review trends.** Follow employees with a scored review in every quarter. Keep reviews before the recorded exit and group the four reviews by the employee's Q1 department and manager.

## Run the automated tests

Run from `Employees Dashboard` once the Python dependencies are installed.

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

The standard suite checks the presentation calculations with small examples and reproduces key slide numbers from a fresh import of the supplied workbook. The API integration tests import temporary Excel files into SQLite, call FastAPI, and compare the responses before and after changing filters. They also cover repeat imports, failed-import rollback, missing records, invalid filters, and cross-worksheet matches. These tests run without starting the dashboard or the API server.

### Verify the real dashboard connection

Start the dashboard and API with **Ctrl+Shift+B**, using the supplied `PA Task.xlsx`. The optional browser suite runs against Next.js on port 3000 and the live FastAPI database on port 8000. Install Playwright and its Chromium browser once.

```powershell
.\.venv\Scripts\python.exe -m pip install playwright==1.65.2
.\.venv\Scripts\python.exe -m playwright install chromium
.\.venv\Scripts\python.exe -m pytest -q browser_checks.py
```

The browser selects **Sales** in Employee Search and **January 12–22, 2025** in Attrition Events. It checks the query parameters on the actual HTTP requests and the updated results shown in the dashboard. To run in an existing Microsoft Edge installation, set `$env:DASHBOARD_TEST_BROWSER = "msedge"` before the test command.
