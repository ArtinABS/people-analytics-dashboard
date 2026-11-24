import { useEffect, useState } from "react";
import { fetchEmployeeJson } from "./employee-request";

export function worksheetPath(path, filters = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && item !== undefined) params.append(name, item);
    }
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function useWorksheetQuery(path) {
  const [response, setResponse] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    fetchEmployeeJson(path, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResponse({ path, attempt, data, latest: data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setResponse((previous) => ({ path, attempt, error: error.message, latest: previous?.latest }));
        }
      });
    return () => controller.abort();
  }, [path, attempt]);

  const current = response?.path === path && response.attempt === attempt ? response : null;
  return {
    data: current?.data,
    latest: response?.latest,
    error: current?.error,
    loading: path !== null && current === null,
    retry: () => setAttempt((value) => value + 1),
  };
}
