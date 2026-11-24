# Employees dashboard

A local Next.js and FastAPI dashboard using the `Employees`, `Monthly Employee Data`, `Attrition Events`, `Engagement Surveys`, `Performance Reviews`, and `Recruitment` worksheets in `PA Task.xlsx`.

## Run it locally

Use Python 3.11+ and Node.js 20.9+. Open this repository folder in VS Code and press **Ctrl+Shift+B**. The task opens three named terminals. To load the supplied `PA Task.xlsx` automatically on first start, put it in a `Given Files` folder beside this repo. You can also load it from the dashboard.

- **Database** prepares the Python environment and uses the existing SQLite database, or imports the supplied workbook on first run if present.
- **Backend** starts FastAPI on port 8000 after database setup.
- **Frontend** installs Node dependencies when needed and starts Next.js on port 3000 after setup.

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

## Import a workbook in the dashboard

Choose **Import Excel** under **Dashboard tools**, select an `.xlsx` file, and click **Import workbook**. Use the same six data worksheets and column names as `PA Task.xlsx`. The import accepts files up to 20 MB.

The browser sends the workbook to `POST /imports/workbook` as a multipart form field named `file`. FastAPI calls the Python importer, which replaces all worksheet tables in one SQLite transaction. A successful response contains the filename and employee count. Re-importing the same workbook produces the same rows. If an import fails, the existing data is preserved. The dashboard reloads its data after success, and the imported data persists across restarts.

## Follow one request

1. `import_employees.py` reads the workbook's `Employees` sheet with openpyxl. It saves the roster and latest import details in the same SQLite transaction. The supplied workbook has 360 records.
2. Open **Search employees**, choose **Sales** under **Department**, and click **Search**. The dashboard sends `GET http://127.0.0.1:8000/employees?department=Sales`.
3. FastAPI reads the matching SQLite rows and returns JSON with `total`, `departments`, and `employees`. The Sales filter returns 103 records.
4. Open the floating **DevTools** panel from any worksheet. It shows the last 12 requests made during the current page session, including their URLs, HTTP statuses, and timings. On Overview, **Run search again** repeats the current search.

The browser sees ports 3000 and 8000 as different origins. FastAPI's CORS setting allows the dashboard's local origin to make API requests.

The search supports all nine worksheet columns. Combined filters must all match. Employee ID accepts a prefix and tenure matches an exact value. Hire date and date of birth use inclusive start and end dates. Fill either date to search with just that bound. The query parameters are `hire_date_from`, `hire_date_to`, `date_of_birth_from`, and `date_of_birth_to`. Each takes an ISO date.

`GET /employees/filters` supplies the dropdown choices. The search response contains the six summary columns. Selecting a result calls `GET /employees/{employee_id}` to load all nine fields in the employee drawer.

## Monthly Employee Data

The workbook import stores monthly records in SQLite, keyed by employee ID and month. The Employee-first tab loads available choices from `GET /monthly-employees/options`. Changing the employee or months sends `GET /monthly-employees/{employee_id}/selection` with a repeated `month` parameter. The API returns the selected snapshots and the employee's latest record for the summary. The view starts on the latest workbook month and the lowest employee ID with a record in that month.

The summary below the filters shows department, manager ID, and tenure from the employee's latest available record. The latest promotion month and year come from subtracting the promotion offset in that record from its month. Selecting other months for comparison keeps the summary on the latest record.

Select one or more months. When comparing months, hover over a chart point to see its score, salary grade, and employment status. Select a point to update the gauges and the shared detail section. Missing records or scores leave gaps. The gauges and trends use a shared 0–5 display scale and preserve the workbook values.

## Attrition Events

`GET /attrition-events/summary` returns date-scoped chart counts and filtered table rows. The exit-date range sends `exit_date_from` and `exit_date_to` as inclusive ISO dates. Chart and dropdown selections also send a new request. Multiple reasons or types match any selected value within that category. Filters across categories must all match. The rehire and interview bars share their selections with the table dropdowns.

## Engagement Surveys

`GET /engagement-surveys/options` provides available filters. The survey quarter, department, and employee selection call `GET /engagement-surveys/summary`. Python calculates the overall satisfaction averages for the selected quarter, the six department trends across all quarters, and the individual timeline through the selected quarter. Blank scores are excluded from averages. Department and employee selections scope the individual timeline.

## Performance Reviews

`GET /performance-reviews/summary` receives the quarter and grouping, then computes the distributions and promotion readiness in Python. Score distributions use valid scored reviews as their denominator. Promotion readiness uses all reviews in the group. Across all quarters, one employee can contribute more than one review.

Select an Employee ID to request that individual's history with `GET /performance-reviews?employee_id=...`. The summary uses the latest available review for promotion readiness and estimates the promotion month by subtracting the recorded promotion offset from the review month.

## Recruitment

`GET /recruitment/options` supplies the department and position branches. Choosing a position sends both fields to `GET /recruitment/summary`, which returns its opening history and KPIs. Each worksheet row counts as one opening. Offers made sums the offer-count field, and acceptance counts use the outcome recorded for each opening.

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

The browser exercises filters in Employee Search, Monthly Employee Data, Attrition Events, Engagement Surveys, Performance Reviews, and Recruitment. It checks the query parameters on the actual HTTP requests and the updated results shown in the dashboard. To run in an existing Microsoft Edge installation, set `$env:DASHBOARD_TEST_BROWSER = "msedge"` before the test command.
