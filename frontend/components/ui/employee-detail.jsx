"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Drawer, Skeleton } from "@heroui/react";
import { fetchEmployeeJson } from "../../app/employee-request";

const DETAIL_FIELDS = [
  ["department", "Department"],
  ["manager_id", "Manager ID"],
  ["hire_date", "Hire date"],
  ["initial_salary_grade", "Initial salary grade"],
  ["employment_type", "Employment type"],
  ["work_location", "Work location"],
  ["date_of_birth", "Date of birth"],
  ["tenure_months", "Tenure in months"],
];

export function EmployeeDetail({ employeeId, onClose }) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const detail = state?.employeeId === employeeId && state?.attempt === attempt ? state : null;

  useEffect(() => {
    if (employeeId === null) return;
    const controller = new AbortController();
    fetchEmployeeJson(`/employees/${employeeId}`, controller.signal)
      .then((employee) => {
        if (!controller.signal.aborted) setState({ employee, employeeId, attempt });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ error: error.message, employeeId, attempt });
      });
    return () => controller.abort();
  }, [employeeId, attempt]);

  return (
    <Drawer>
      <Drawer.Backdrop isOpen={employeeId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
        <Drawer.Content placement="right" className="employee-drawer">
          <Drawer.Dialog>
            <Drawer.Header>
              <Drawer.Heading>Employee {employeeId}</Drawer.Heading>
              <Drawer.CloseTrigger aria-label="Close employee details" />
            </Drawer.Header>
            <Drawer.Body>
              {detail?.employee ? (
                <dl className="employee-details">
                  {DETAIL_FIELDS.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{detail.employee[key]}</dd>
                    </div>
                  ))}
                </dl>
              ) : detail?.error ? (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{detail.error}</Alert.Description>
                    <Button size="sm" variant="secondary" onPress={() => setAttempt((n) => n + 1)}>Retry</Button>
                  </Alert.Content>
                </Alert>
              ) : (
                <div className="loading-lines" role="status" aria-label="Loading employee details">
                  <Skeleton /><Skeleton /><Skeleton />
                </div>
              )}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
