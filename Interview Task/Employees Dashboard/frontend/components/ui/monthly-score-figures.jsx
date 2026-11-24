"use client";

import { Label, Meter, Typography } from "@heroui/react";
import { useId } from "react";
import { formatMonth } from "../../app/period-labels";
import { Charts } from "./charts";

export const SCORE_METRICS = [
  { key: "performance_rating", label: "Performance rating", color: "var(--accent)" },
  { key: "engagement_score", label: "Engagement score", color: "var(--indigo)" },
  { key: "skills_gap_score", label: "Skills gap score", color: "var(--muted)" },
];

const MAX_SCORE = 5;
const SCORE_FORMAT = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const SHORT_MONTH = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const SHORT_MONTH_YEAR = new Intl.DateTimeFormat("en", { month: "short", year: "2-digit", timeZone: "UTC" });

function ScoreArc({ value, color }) {
  const gradient = useId();
  const arc = "M 9 55 A 46 46 0 0 1 101 55";
  const fill = Math.max(0, Math.min(value / MAX_SCORE, 1)) * 100;
  return (
    <svg className="monthly-gauge-arc" viewBox="0 0 110 60" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x2="100%" y2="0%">
          <stop stopColor={color} stopOpacity=".55" />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
      </defs>
      <path d={arc} stroke="var(--border)" opacity=".6" />
      {fill > 0 && (
        <path d={arc} pathLength={100} stroke={`url(#${gradient})`} strokeDasharray={`${fill} 100`} />
      )}
    </svg>
  );
}

export function MonthlyGauge({ metric, value }) {
  if (value == null) {
    return (
      <div className="monthly-gauge">
        <span className="monthly-gauge-label">{metric.label}</span>
        <ScoreArc value={0} color={metric.color} />
        <Typography.Paragraph className="monthly-gauge-empty">No score</Typography.Paragraph>
      </div>
    );
  }

  return (
    <Meter
      className="monthly-gauge"
      minValue={0}
      maxValue={MAX_SCORE}
      value={value}
      valueLabel={`${SCORE_FORMAT.format(value)} out of ${MAX_SCORE}`}
    >
      <Label className="monthly-gauge-label">{metric.label}</Label>
      <ScoreArc value={value} color={metric.color} />
      <Meter.Output className="monthly-gauge-output">
        {SCORE_FORMAT.format(value)} <span>/ {MAX_SCORE}</span>
      </Meter.Output>
    </Meter>
  );
}

function monthIndex(month) {
  const [year, monthOfYear] = month.split("-").map(Number);
  return year * 12 + monthOfYear;
}

export function MonthlyTrend({ metric, periods, detailMonth, onSelectMonth }) {
  const titleId = useId();
  const monthFormat = periods[0].month.slice(0, 4) === periods.at(-1).month.slice(0, 4) ? SHORT_MONTH : SHORT_MONTH_YEAR;
  const data = periods.map(({ month, record }) => ({
    month,
    index: monthIndex(month),
    score: record?.[metric.key] ?? null,
    salary_grade: record?.salary_grade ?? null,
    employment_status: record?.employment_status ?? null,
  }));
  const months = new Map(data.map((row) => [row.index, row.month]));
  const formatTick = (index) => {
    const month = months.get(index);
    return month ? monthFormat.format(new Date(`${month}-01T00:00:00Z`)) : "";
  };

  return (
    <figure className="monthly-trend" aria-labelledby={titleId}>
      <figcaption id={titleId}>{metric.label}</figcaption>
      <Charts
        className="monthly-trend-chart"
        type="line"
        title={metric.label}
        description={data.map(({ month, score }) => `${formatMonth(month)}: ${score ?? "No score"}`).join(". ")}
        data={data}
        xKey="index"
        xDomain={[data[0].index, data.at(-1).index]}
        xTicks={data.map(({ index }) => index)}
        domain={[0, MAX_SCORE]}
        ticks={[0, MAX_SCORE / 2, MAX_SCORE]}
        series={[{ key: "score", label: metric.label, color: metric.color }]}
        formatCategory={formatTick}
        formatTooltipLabel={(index) => formatMonth(months.get(index))}
        selectedPoint={monthIndex(detailMonth)}
        onPointSelect={({ month }) => onSelectMonth(month)}
        tooltipDetails={({ salary_grade, employment_status }) => (
          <dl>
            <div><dt>Salary grade</dt><dd>{salary_grade}</dd></div>
            <div><dt>Employment status</dt><dd>{employment_status}</dd></div>
          </dl>
        )}
      />
    </figure>
  );
}
