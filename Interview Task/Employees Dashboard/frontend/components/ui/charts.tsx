"use client";

import type { ReactNode } from "react";
import { Button, Tooltip } from "@heroui/react";
import {
  Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis,
} from "recharts";

type ChartValue = string | number | null;
type ChartRow = Record<string, ChartValue>;
type ChartSeries = { key: string; label: string; color: string; dash?: string };
type Domain = [number, number];

type ChartProps = {
  title: string;
  description?: string;
  className?: string;
  data: ChartRow[];
  xKey: string;
  series: ChartSeries[];
  domain: Domain;
  ticks?: number[];
  showValues?: boolean;
  formatCategory?: (value: ChartValue) => string;
  formatTooltipLabel?: (value: ChartValue) => string;
  formatValue?: (value: number) => string;
  formatValueAxis?: (value: number) => string;
  formatTooltipValue?: (value: number, row: ChartRow, seriesKey: string) => string;
  tooltipDetails?: (row: ChartRow) => ReactNode;
};

type LineProps = ChartProps & {
  type: "line";
  xDomain?: Domain;
  xTicks?: number[];
  selectedPoint?: string | number;
  onPointSelect?: (row: ChartRow) => void;
};

type BarProps = ChartProps & {
  type: "bar";
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
  stacked?: boolean;
};

type ChartsProps = LineProps | BarProps;
type DotProps = { cx?: number; cy?: number; payload?: ChartRow; value?: number | null };
const MARGIN = { top: 14, right: 10, bottom: 0, left: 0 };
const TRACK_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 };
const HORIZONTAL_BAR_MARGIN = { top: 4, right: 34, bottom: 0, left: 0 };
const AXIS_TICK = { fill: "var(--muted)" };
const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const valueLabel = (value: number) => numberFormat.format(value);
const categoryLabel = (value: ChartValue) => String(value ?? "");

function TooltipValues({ label, entries }: {
  label: string;
  entries: { label: string; value: string; color?: string }[];
}) {
  return (
    <>
      <p className="chart-tooltip-title">{label}</p>
      <dl>
        {entries.map(({ label: name, value, color }) => (
          <div key={name}>
            <dt>{color && <span className="chart-tooltip-swatch" style={{ backgroundColor: color }} aria-hidden="true" />}{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function SelectableDot({ cx, cy, payload, value, chart, series }: DotProps & { chart: LineProps; series: ChartSeries }) {
  if (cx === undefined || cy === undefined || payload === undefined || value == null) return null;
  const category = payload[chart.xKey];
  const date = (chart.formatTooltipLabel ?? chart.formatCategory ?? categoryLabel)(category);
  const score = (chart.formatValue ?? valueLabel)(value);

  return (
    <foreignObject x={cx - 12} y={cy - 12} width={24} height={24} overflow="visible">
      <Tooltip delay={100} closeDelay={100}>
        <Button
          className="chart-point"
          variant="ghost"
          isIconOnly
          aria-label={`${date}, ${series.label}: ${score}`}
          aria-pressed={category === chart.selectedPoint}
          onPress={() => chart.onPointSelect?.(payload)}
        >
          <span style={{ backgroundColor: series.color }} aria-hidden="true" />
        </Button>
        <Tooltip.Content placement="top" className="dashboard-chart-tooltip">
          <TooltipValues label={date} entries={[{ label: series.label, value: score }]} />
          {chart.tooltipDetails?.(payload)}
        </Tooltip.Content>
      </Tooltip>
    </foreignObject>
  );
}

export function Charts(props: ChartsProps) {
  const { title, description, className = "", data, xKey, series, domain, ticks } = props;
  const formatCategory = props.formatCategory ?? categoryLabel;
  const formatTooltipLabel = props.formatTooltipLabel ?? formatCategory;
  const formatValue = props.formatValue ?? valueLabel;
  const formatTooltipValue = props.formatTooltipValue ?? formatValue;
  const formatDataLabel = (value: unknown) => typeof value === "number" ? formatValue(value) : "";
  const decorative = props.type === "bar" && props.decorative;
  const horizontalBars = props.type === "bar" && (decorative || props.orientation === "horizontal");
  const tooltip = (
    <ChartTooltip
      isAnimationActive={false}
      filterNull={false}
      cursor={{ fill: "var(--stripe)", stroke: "var(--separator)", strokeWidth: 1 }}
      content={({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        const row: ChartRow = payload[0].payload;
        const entries = series.map(({ key, label: name, color }) => ({
          label: name,
          color: series.length === 1 && typeof row.fill === "string" ? row.fill : color,
          value: typeof row[key] === "number" ? formatTooltipValue(row[key], row, key) : "No score",
        }));
        return (
          <div className="dashboard-chart-tooltip">
            <TooltipValues label={formatTooltipLabel(label ?? row[xKey])} entries={entries} />
            {props.tooltipDetails?.(row)}
          </div>
        );
      }}
    />
  );
  const grid = <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />;
  const categoryAxis = (
    <XAxis dataKey={xKey} axisLine={false} tickLine={false} tick={AXIS_TICK} tickMargin={7} minTickGap={8} tickFormatter={formatCategory} />
  );
  const valueAxis = <YAxis domain={domain} ticks={ticks} tickLine={false} axisLine={false}
    tick={AXIS_TICK} tickMargin={6} width={26} tickFormatter={props.formatValueAxis} />;

  return (
    <div className={`dashboard-chart ${className}`} data-chart-type={props.type} aria-hidden={decorative || undefined}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {props.type === "line" ? (
          <LineChart data={data} title={title} desc={description} accessibilityLayer={!props.onPointSelect} margin={MARGIN}>
            {grid}
            {props.xDomain ? (
              <XAxis dataKey={xKey} type="number" domain={props.xDomain} ticks={props.xTicks}
                axisLine={false} tickLine={false} tick={AXIS_TICK} tickMargin={7} minTickGap={8} tickFormatter={formatCategory} />
            ) : categoryAxis}
            {valueAxis}
            {!props.onPointSelect && tooltip}
            {series.map((item) => (
              <Line
                key={item.key}
                dataKey={item.key}
                name={item.label}
                type="monotone"
                stroke={item.color}
                strokeDasharray={item.dash}
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
                dot={props.onPointSelect
                  ? (dot) => <SelectableDot {...dot} chart={props} series={item} />
                  : { r: 3.4, fill: item.color, stroke: "var(--surface)", strokeWidth: 1 }}
                activeDot={props.onPointSelect ? false : { r: 4.5 }}
              >
                {props.showValues && <LabelList dataKey={item.key} position="top" fill="var(--foreground)" formatter={formatDataLabel} />}
              </Line>
            ))}
          </LineChart>
        ) : (
          <BarChart
            layout={horizontalBars ? "vertical" : "horizontal"}
            data={data}
            title={title}
            desc={description}
            accessibilityLayer={!decorative}
            margin={decorative ? TRACK_MARGIN : horizontalBars ? HORIZONTAL_BAR_MARGIN : MARGIN}
            barCategoryGap={decorative ? 0 : undefined}
          >
            {!decorative && (horizontalBars
              ? <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
              : grid)}
            {horizontalBars ? (
              <>
                <XAxis type="number" domain={domain} ticks={ticks} hide={decorative}
                  axisLine={false} tickLine={false} tick={AXIS_TICK} tickMargin={7} tickFormatter={props.formatValueAxis} />
                <YAxis type="category" dataKey={xKey} hide={decorative}
                  axisLine={false} tickLine={false} tick={AXIS_TICK} tickMargin={8} width={74}
                  tickFormatter={formatCategory} />
              </>
            ) : <>{categoryAxis}{valueAxis}</>}
            {!decorative && tooltip}
            {series.map((item) => (
              <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color}
                stackId={props.stacked ? "total" : undefined}
                maxBarSize={decorative ? undefined : horizontalBars ? 27 : 100}
                radius={decorative || props.stacked ? 0 : horizontalBars ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                isAnimationActive={false}>
                {props.showValues && <LabelList dataKey={item.key} position={horizontalBars ? "right" : "top"}
                  fill="var(--foreground)" formatter={formatDataLabel} />}
              </Bar>
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
