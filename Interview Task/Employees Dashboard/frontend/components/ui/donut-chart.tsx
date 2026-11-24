"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

export interface DonutChartSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: readonly DonutChartSegment[];
  selected: ReadonlySet<string>;
  hovered: string | null;
  centerContent: ReactNode;
  onSegmentHover: (label: string | null) => void;
  onSegmentPress: (label: string) => void;
}

export function DonutChart({
  data, selected, hovered, centerContent, onSegmentHover, onSegmentPress,
}: DonutChartProps) {
  const reducedMotion = useReducedMotion();
  const segments = data.filter((segment) => segment.value > 0);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut-chart">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="var(--border)" strokeWidth="22" />
        <g transform="rotate(-90 100 100)">
          {segments.map(({ label, value, color }, index) => {
            const length = value / total * circumference;
            const gap = segments.length > 1 ? Math.min(3, length / 5) : 0;
            const start = offset + gap / 2;
            offset += length;

            return (
              <motion.circle
                key={label}
                className="donut-segment"
                data-hovered={hovered === label}
                data-dimmed={selected.size > 0 && !selected.has(label) && hovered !== label}
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth="22"
                strokeDasharray={`${length - gap} ${circumference}`}
                strokeDashoffset={-start}
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.24, delay: index * 0.025 }}
                onPointerEnter={() => onSegmentHover(label)}
                onPointerLeave={() => onSegmentHover(null)}
                onClick={() => onSegmentPress(label)}
              />
            );
          })}
        </g>
      </svg>
      <div className="donut-center" aria-hidden="true">{centerContent}</div>
    </div>
  );
}
