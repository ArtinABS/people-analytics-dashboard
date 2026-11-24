"use client";

import { Button, Chip, Disclosure, Typography } from "@heroui/react";
import { CodeXml } from "lucide-react";
import { useSyncExternalStore } from "react";
import { getApiRequests, subscribeToApiRequests } from "../../app/employee-request";

const EMPTY_REQUESTS = [];
const requestTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const STATE_LABELS = {
  pending: "Pending",
  success: "Complete",
  canceled: "Canceled",
  failed: "Failed",
};

export function DevTools({ isOpen, onOpenChange, triggerRef, onRepeatSearch, isRepeating }) {
  const requests = useSyncExternalStore(subscribeToApiRequests, getApiRequests, () => EMPTY_REQUESTS);

  return (
    <aside id="dashboard-devtools" className="devtools" data-open={isOpen} aria-label="API DevTools">
      <Disclosure isExpanded={isOpen} onExpandedChange={onOpenChange}>
        <Disclosure.Heading>
          <Disclosure.Trigger ref={triggerRef}>
            <CodeXml className="devtools-icon" aria-hidden="true" />
            <span>DevTools</span>
            <Disclosure.Indicator />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body className="devtools-content">
            <div className="devtools-request-heading">
              <Typography.Paragraph className="request-label">Recent API requests</Typography.Paragraph>
              {onRepeatSearch && (
                <Button className="run-request" variant="outline" size="sm" isDisabled={isRepeating} onPress={onRepeatSearch}>
                  Run search again
                </Button>
              )}
            </div>
            {requests.length === 0 ? (
              <Typography.Paragraph className="request-empty">No API requests yet.</Typography.Paragraph>
            ) : (
              <ol className="request-list">
                {requests.map(({ id, method, url, startedAt, state, status, duration, message }) => (
                  <li key={id}>
                    <div className="request-line">
                      <Chip className="request-method" size="sm" variant="soft">{method}</Chip>
                      <Typography.Code className="request-url">{url}</Typography.Code>
                    </div>
                    <div className="request-meta">
                      <Chip className="request-status" data-state={state} size="sm" variant="soft">
                        {status ? `HTTP ${status}` : STATE_LABELS[state]}
                        {status && state !== "success" ? ` · ${STATE_LABELS[state]}` : ""}
                      </Chip>
                      {duration !== undefined && <span>{duration} ms</span>}
                      <time dateTime={new Date(startedAt).toISOString()}>{requestTime.format(startedAt)}</time>
                    </div>
                    {message && <Typography.Paragraph className="request-error">{message}</Typography.Paragraph>}
                  </li>
                ))}
              </ol>
            )}
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
    </aside>
  );
}
