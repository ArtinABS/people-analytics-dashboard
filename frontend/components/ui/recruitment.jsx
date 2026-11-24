"use client";

import { Chip, Table, Typography } from "@heroui/react";
import { useState } from "react";
import { useWorksheetQuery, worksheetPath } from "../../app/worksheet-query";
import { BranchedMenu } from "./branched-menu";
import { CopyAnalysisKeys } from "./copy-analysis-keys";
import { WorksheetFeedback } from "./worksheet-feedback";

const NUMBER = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const RATING = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const QUALITY_FIELDS = [
  { field: "quality_of_hire_90d", label: "Quality of hire", column: "Quality of hire (90d)" },
  { field: "manager_satisfaction_90d", label: "Manager satisfaction", column: "Manager satisfaction (90d)" },
];

function departmentBranches(options) {
  const departments = new Map();
  for (const { department, position } of options) {
    if (!departments.has(department)) departments.set(department, []);
    departments.get(department).push({
      key: JSON.stringify([department, position]), label: position, department,
    });
  }
  return [...departments].map(([department, children]) => ({ key: department, label: department, children }));
}

function outcome(accepted) {
  if (accepted === null) return "Not recorded";
  return accepted ? "Accepted" : "Not accepted";
}

function formatValue(value, formatter = NUMBER) {
  return value === null ? "—" : formatter.format(value);
}

function OpeningDate({ date }) {
  return date
    ? <time dateTime={date}>{DATE.format(new Date(`${date}T00:00:00Z`))}</time>
    : "—";
}

export function Recruitment() {
  const options = useWorksheetQuery("/recruitment/options");
  if (!options.data) return <WorksheetFeedback request={options} subject="recruitment positions" />;
  if (!options.data.length) {
    return <Typography.Paragraph className="search-hint">The workbook has no recruitment records.</Typography.Paragraph>;
  }
  return <RecruitmentPositions branches={departmentBranches(options.data)} />;
}

function RecruitmentPositions({ branches }) {
  const [selected, setSelected] = useState(() => branches[0].children[0].key);
  const position = branches.flatMap(({ children }) => children).find(({ key }) => key === selected);

  return (
    <div className="recruitment-dashboard">
      <div className="recruitment-layout">
        <section className="recruitment-positions" aria-labelledby="recruitment-positions-heading">
          <Typography.Heading level={2} id="recruitment-positions-heading">Positions</Typography.Heading>
          <BranchedMenu
            label="Positions by department"
            branches={branches}
            defaultOpen={branches[0].key}
            selected={selected}
            onSelect={setSelected}
          />
        </section>
        <PositionDetails position={position} />
      </div>
    </div>
  );
}

function PositionDetails({ position: { label, department } }) {
  const request = useWorksheetQuery(worksheetPath("/recruitment/summary", { department, position: label }));
  if (!request.data) return <WorksheetFeedback request={request} subject="recruitment results" />;
  const summary = request.data;
  const { openings, offers, accepted, not_accepted, unknown, hires, cost_per_hire } = summary;
  if (!openings.length) {
    return <Typography.Paragraph className="search-hint">No openings match this position.</Typography.Paragraph>;
  }
  const overview = [
    ["Times opened", openings.length],
    ["Offers made", formatValue(offers)],
    ["Accepted openings", accepted],
    ["Openings not accepted", not_accepted],
    ["Average cost per hire", formatValue(cost_per_hire.average), "recruitment-cost"],
  ];
  if (unknown) overview.splice(4, 0, ["Outcome not recorded", unknown]);

  return (
    <section className="recruitment-detail" aria-labelledby="recruitment-position-heading">
      <div className="survey-section-heading">
        <Typography.Heading level={2} id="recruitment-position-heading" aria-live="polite">{label}</Typography.Heading>
        <Typography.Paragraph className="search-hint">{department}</Typography.Paragraph>
      </div>

      <dl className="recruitment-overview">
        {overview.map(([name, value, className]) => (
          <div key={name} className={className}><dt>{name}</dt><dd>{value}</dd></div>
        ))}
      </dl>

      <section className="recruitment-quality" aria-labelledby="recruitment-quality-heading">
        <Typography.Heading level={3} id="recruitment-quality-heading">90-day hiring outcomes</Typography.Heading>
        <dl className="recruitment-quality-grid">
          {QUALITY_FIELDS.map(({ field, label }) => {
            const { count, average } = summary[field];
            return (
              <div key={field}>
                <dt>{label}</dt>
                <dd>{formatValue(average, RATING)}</dd>
                <dd className="search-hint">{count} of {hires} hires with a recorded score</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="recruitment-records" aria-labelledby="recruitment-openings-heading">
        <Typography.Heading level={3} id="recruitment-openings-heading">Opening history</Typography.Heading>
        <CopyAnalysisKeys rows={openings} dates={[["opening_date", "Opening date"], ["hire_date", "Hire date"]]} />
        <OpeningHistory openings={openings} />
      </section>
    </section>
  );
}

function OpeningHistory({ openings }) {
  return (
    <Table className="employee-table recruitment-table" variant="secondary">
      <Table.ScrollContainer className="table-scroll" role="region" aria-label="Scrollable opening history" tabIndex={0}>
        <Table.Content aria-label="Opening history">
          <Table.Header>
            <Table.Column isRowHeader>Opening date</Table.Column>
            <Table.Column>Offers made</Table.Column>
            <Table.Column>Offer outcome</Table.Column>
            <Table.Column>Hire date</Table.Column>
            <Table.Column>Cost per hire</Table.Column>
            {QUALITY_FIELDS.map(({ field, column }) => <Table.Column id={field} key={field}>{column}</Table.Column>)}
          </Table.Header>
          <Table.Body items={openings}>
            {(opening) => (
              <Table.Row id={opening.recruitment_id}>
                <Table.Cell><OpeningDate date={opening.opening_date} /></Table.Cell>
                <Table.Cell>{formatValue(opening.offers_made)}</Table.Cell>
                <Table.Cell><Chip variant="soft" size="sm" color={opening.offer_accepted ? "success" : "default"}>
                  {outcome(opening.offer_accepted)}
                </Chip></Table.Cell>
                <Table.Cell><OpeningDate date={opening.hire_date} /></Table.Cell>
                <Table.Cell>{formatValue(opening.cost_per_hire)}</Table.Cell>
                {QUALITY_FIELDS.map(({ field }) => <Table.Cell key={field}>{formatValue(opening[field])}</Table.Cell>)}
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
