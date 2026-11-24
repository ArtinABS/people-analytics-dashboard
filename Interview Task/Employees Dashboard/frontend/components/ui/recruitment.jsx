"use client";

import { Alert, Button, Chip, Skeleton, Table, Typography } from "@heroui/react";
import { useEffect, useState } from "react";
import { fetchEmployeeJson } from "../../app/employee-request";
import { BranchedMenu } from "./branched-menu";
import { CopyAnalysisKeys } from "./copy-analysis-keys";

const NUMBER = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const RATING = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const QUALITY_FIELDS = [
  { field: "quality_of_hire_90d", label: "Quality of hire", column: "Quality of hire (90d)" },
  { field: "manager_satisfaction_90d", label: "Manager satisfaction", column: "Manager satisfaction (90d)" },
];

function departmentBranches(records) {
  const departments = new Map();
  for (const record of records) {
    const { department, position } = record;
    if (!departments.has(department)) departments.set(department, new Map());
    const positions = departments.get(department);
    if (!positions.has(position)) positions.set(position, []);
    positions.get(position).push(record);
  }
  return [...departments]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([department, positions]) => ({
      key: department,
      label: department,
      children: [...positions]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([position, openings]) => ({
          key: JSON.stringify([department, position]),
          label: position,
          department,
          openings,
        })),
    }));
}

function summarize(openings, field) {
  const values = openings.map((row) => row[field]).filter(Number.isFinite);
  return { count: values.length, sum: values.reduce((total, value) => total + value, 0) };
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
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchEmployeeJson("/recruitment", controller.signal)
      .then((openings) => {
        if (!controller.signal.aborted) setResult({ openings });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ error: error.message });
      });
    return () => controller.abort();
  }, [attempt]);

  if (result === null) {
    return (
      <div className="loading-lines monthly-loading" role="status" aria-label="Loading recruitment records">
        <Skeleton /><Skeleton /><Skeleton />
      </div>
    );
  }
  if (result.error) {
    return (
      <Alert status="danger" className="search-alert">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>Could not load recruitment records. {result.error}</Alert.Description>
          <Button size="sm" variant="secondary" onPress={() => {
            setResult(null);
            setAttempt((value) => value + 1);
          }}>Retry</Button>
        </Alert.Content>
      </Alert>
    );
  }
  if (!result.openings.length) {
    return <Typography.Paragraph className="search-hint">The workbook has no recruitment records.</Typography.Paragraph>;
  }
  return <RecruitmentPositions branches={departmentBranches(result.openings)} />;
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

function PositionDetails({ position: { label, department, openings } }) {
  const offers = summarize(openings, "offers_made");
  const accepted = openings.filter(({ offer_accepted }) => offer_accepted === true).length;
  const notAccepted = openings.filter(({ offer_accepted }) => offer_accepted === false).length;
  const noOutcome = openings.length - accepted - notAccepted;
  const hires = openings.filter(({ hire_date }) => hire_date !== null);
  const cost = summarize(hires, "cost_per_hire");
  const overview = [
    ["Times opened", openings.length],
    ["Offers made", offers.count ? NUMBER.format(offers.sum) : "—"],
    ["Accepted openings", accepted],
    ["Openings not accepted", notAccepted],
    ["Average cost per hire", cost.count ? NUMBER.format(cost.sum / cost.count) : "—", "recruitment-cost"],
  ];
  if (noOutcome) overview.splice(4, 0, ["Outcome not recorded", noOutcome]);

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
            const { count, sum } = summarize(hires, field);
            return (
              <div key={field}>
                <dt>{label}</dt>
                <dd>{count ? RATING.format(sum / count) : "—"}</dd>
                <dd className="search-hint">{count} of {hires.length} hires with a recorded score</dd>
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
