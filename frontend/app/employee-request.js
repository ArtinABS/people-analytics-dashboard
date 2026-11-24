const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const REQUEST_LIMIT = 12;
const listeners = new Set();
let requests = [];
let nextId = 0;

export function subscribeToApiRequests(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getApiRequests() {
  return requests;
}

function setRequests(nextRequests) {
  requests = nextRequests;
  for (const listener of listeners) listener();
}

export async function fetchEmployeeJson(path, signal, json) {
  const url = `${API_URL}${path}`;
  const method = json === undefined ? "GET" : "POST";
  const id = ++nextId;
  const started = performance.now();
  setRequests([
    { id, url, method, startedAt: Date.now(), state: "pending" },
    ...requests,
  ].slice(0, REQUEST_LIMIT));

  let response;
  let state = "success";
  let message;
  try {
    response = await fetch(url, {
      method,
      signal,
      cache: "no-store",
      ...(json === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = typeof body?.detail === "string" ? body.detail : null;
      throw new Error(detail || `Request failed (HTTP ${response.status}).`);
    }
    return await response.json();
  } catch (error) {
    if (signal?.aborted || error.name === "AbortError") {
      state = "canceled";
      throw error;
    }
    state = "failed";
    message = response ? error.message : "Could not reach FastAPI. Check that the API server is running.";
    throw response ? error : new Error(message);
  } finally {
    const duration = Math.round(performance.now() - started);
    setRequests(requests.map((request) => request.id === id ? {
      ...request,
      state,
      status: response?.status,
      duration,
      message,
    } : request));
  }
}
