"use client";

import { Typography } from "@heroui/react";
import { useId } from "react";
import { Charts } from "./charts";

const SCORE = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GRADE_TICKS = [1, 2, 3, 4, 5];
const formatScore = (score) => score === null ? "No score" : SCORE.format(score);

export function SatisfactionBars({ data, quarter }) {
  return (
    <Charts
      className="survey-satisfaction-chart"
      type="bar"
      orientation="horizontal"
      title={`Overall satisfaction by department, ${quarter}`}
      description={data.map(({ name, score }) => `${name}: ${formatScore(score)}`).join(". ")}
      data={data.map(({ name, score, color }) => ({ name, score, fill: color }))}
      xKey="name"
      domain={[0, 5]}
      ticks={[0, ...GRADE_TICKS]}
      series={[{ key: "score", label: "Overall satisfaction", color: "var(--accent)" }]}
      formatValue={formatScore}
      showValues
    />
  );
}

export function DepartmentTrends({ departments, metrics, quarters }) {
  const periodLabel = quarters[0] === quarters.at(-1) ? quarters[0] : `${quarters[0]} – ${quarters.at(-1)}`;

  return (
    <section className="survey-department-trends" aria-labelledby="survey-department-trends-heading">
      <div className="survey-section-header">
        <div className="survey-section-heading">
          <Typography.Heading level={2} id="survey-department-trends-heading">Department trends</Typography.Heading>
          <Typography.Paragraph className="search-hint">{periodLabel} · Average scores on a 1–5 scale</Typography.Paragraph>
        </div>
        <ul className="survey-department-legend" aria-label="Department colors">
          {departments.map(({ name, color, dash }) => (
            <li key={name}>
              <svg viewBox="0 0 25 10" aria-hidden="true" style={{ color }}>
                <path d="M1 5 H24" stroke="currentColor" strokeWidth="2" strokeDasharray={dash} />
                <circle cx="12.5" cy="5" r="2.8" fill="currentColor" />
              </svg>
              {name}
            </li>
          ))}
        </ul>
      </div>
      <div className="survey-department-grid">
        {metrics.map((metric) => <DepartmentTrend key={metric.key} metric={metric} departments={departments} quarters={quarters} />)}
      </div>
    </section>
  );
}

function DepartmentTrend({ metric, departments, quarters }) {
  const titleId = useId();
  const series = departments.map(({ name, color, dash }, index) => ({
    key: `department_${index}`, label: name, color, dash,
  }));
  const data = quarters.map((quarter, index) => ({
    quarter,
    ...Object.fromEntries(series.map(({ key }, departmentIndex) => [key, departments[departmentIndex].scores[metric.key][index]])),
  }));
  const description = series.map(({ label, key }) => (
    `${label}: ${data.map((row) => `${row.quarter} ${formatScore(row[key])}`).join(", ")}`
  )).join(". ");
  const singleYear = quarters[0].slice(-4) === quarters.at(-1).slice(-4);

  return (
    <figure className="survey-department-trend" aria-labelledby={titleId}>
      <figcaption id={titleId}>{metric.label}</figcaption>
      <Charts
        className="survey-department-chart"
        type="line"
        title={metric.label}
        description={description}
        data={data}
        xKey="quarter"
        domain={[1, 5]}
        ticks={GRADE_TICKS}
        series={series}
        formatCategory={singleYear ? (quarter) => quarter.split(" ")[0] : undefined}
        formatTooltipLabel={(quarter) => quarter}
        formatValue={formatScore}
      />
    </figure>
  );
}
