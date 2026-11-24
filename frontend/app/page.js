"use client";

import { useEffect, useRef, useState } from "react";
import { Card, Typography } from "@heroui/react";
import { AdvancedAnalysis } from "../components/ui/advanced-analysis";
import { AttritionEvents } from "../components/ui/attrition-events";
import { DevTools } from "../components/ui/devtools";
import { EmployeeDetail } from "../components/ui/employee-detail";
import { EmployeeSearch } from "../components/ui/employee-search";
import { EngagementSurveys } from "../components/ui/engagement-surveys";
import { GlassyDashboard, WORKSHEET_VIEWS } from "../components/ui/glassy-dashboard";
import { MonthlyEmployeeData } from "../components/ui/monthly-employee-data";
import { PerformanceReviews } from "../components/ui/performance-reviews";
import { Recruitment } from "../components/ui/recruitment";
import { fetchEmployeeJson } from "./employee-request";

const WORKSHEET_PANELS = {
  "monthly-employee-data": MonthlyEmployeeData,
  "attrition-events": AttritionEvents,
  "engagement-surveys": EngagementSurveys,
  "performance-reviews": PerformanceReviews,
  recruitment: Recruitment,
};

export default function EmployeesDashboard() {
  const [worksheet, setWorksheet] = useState(null);
  const [analysisVisited, setAnalysisVisited] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(null);
  const [query, setQuery] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const devtoolsTrigger = useRef(null);
  const WorksheetPanel = WORKSHEET_PANELS[worksheet?.id];
  const requestPath = query === null ? null : query ? `/employees?${query}` : "/employees";

  useEffect(() => {
    function syncView() {
      const id = window.location.hash.slice(1);
      setWorksheet(WORKSHEET_VIEWS.find((view) => view.id === id) ?? null);
      if (id === "advanced-analysis") setAnalysisVisited(true);
      if (id === "employee-search") setSearchOpen(true);
      if (id === "devtools") setDevtoolsOpen(true);
    }

    syncView();
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, []);

  useEffect(() => {
    if (requestPath === null) return;
    const controller = new AbortController();

    async function loadEmployees() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchEmployeeJson(requestPath, controller.signal);
        if (!controller.signal.aborted) setResult(data);
      } catch (error) {
        if (!controller.signal.aborted) setError(error.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadEmployees();
    return () => controller.abort();
  }, [requestPath, attempt]);

  function submitSearch(filters) {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) {
      if (value !== "") params.set(name, value);
    }
    setQuery(params.toString());
    setLoading(true);
    setAttempt((value) => value + 1);
  }

  function clearSearch() {
    setQuery(null);
    setResult(null);
    setError(null);
    setLoading(false);
  }

  function retrySearch() {
    setLoading(true);
    setAttempt((value) => value + 1);
  }

  function onWorkbookImported() {
    clearSearch();
    setEmployeeId(null);
    setDataRevision((revision) => revision + 1);
  }

  return (
    <GlassyDashboard
      activeView={worksheet?.id ?? "overview"}
      openSearch={() => setSearchOpen(true)}
      onWorkbookImported={onWorkbookImported}
      openDevTools={() => {
        setDevtoolsOpen(true);
        devtoolsTrigger.current?.focus({ preventScroll: true });
      }}
      devtoolsOpen={devtoolsOpen}
      devtools={(
        <DevTools
          isOpen={devtoolsOpen}
          onOpenChange={setDevtoolsOpen}
          triggerRef={devtoolsTrigger}
          onRepeatSearch={worksheet === null && requestPath !== null ? retrySearch : null}
          isRepeating={loading}
        />
      )}
    >
      <header id={worksheet?.id ?? "overview"} className="page-heading">
        <Typography.Heading level={1} tabIndex={-1}>{worksheet?.label ?? "Overview"}</Typography.Heading>
      </header>

      {WorksheetPanel ? <WorksheetPanel key={dataRevision} /> : worksheet && worksheet.id !== "advanced-analysis" && (
        <Card className="overview-panel">
          <Typography.Paragraph>This worksheet view is a placeholder.</Typography.Paragraph>
        </Card>
      )}
      {analysisVisited && <div hidden={worksheet?.id !== "advanced-analysis"}><AdvancedAnalysis key={dataRevision} /></div>}

      <div hidden={worksheet !== null}>
        <Card className="overview-panel" aria-labelledby="overview-empty">
          <Typography.Heading level={2} id="overview-empty">No overview metrics yet</Typography.Heading>
          <Typography.Paragraph>Use employee search to look up an individual record.</Typography.Paragraph>
        </Card>

        <EmployeeSearch
          key={dataRevision}
          isOpen={worksheet === null && searchOpen}
          onOpenChange={setSearchOpen}
          onSearch={submitSearch}
          onClear={clearSearch}
          result={result}
          loading={loading}
          error={error}
          onRetry={retrySearch}
          onSelectEmployee={setEmployeeId}
        />
        <EmployeeDetail employeeId={employeeId} onClose={() => setEmployeeId(null)} />
      </div>
    </GlassyDashboard>
  );
}
