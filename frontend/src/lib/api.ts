import { env } from "./env";

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export const SLOW_MS = 3_000;
export const TIMEOUT_MS = 60_000;

let getToken: () => Promise<string | null> = async () => null;
let onUnauthorized: () => void = () => {};
const slowListeners = new Set<(slow: boolean) => void>();
let slowCount = 0;

export function setTokenGetter(fn: () => Promise<string | null>): void {
  getToken = fn;
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export function onSlowRequest(fn: (slow: boolean) => void): () => void {
  slowListeners.add(fn);
  return () => {
    slowListeners.delete(fn);
  };
}

function bumpSlow(delta: number): void {
  slowCount += delta;
  const slow = slowCount > 0;
  slowListeners.forEach((listener) => listener(slow));
}

type ValidationItem = { loc: (string | number)[]; msg: string };

function toApiError(status: number, data: unknown): ApiError {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (status === 422 && Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {};
    let general: string | null = null;
    for (const item of detail as ValidationItem[]) {
      const field = item.loc[item.loc.length - 1];
      const msg = item.msg.replace(/^Value error, /, "");
      if (typeof field === "string" && field !== "body") fieldErrors[field] = msg;
      else general = msg;
    }
    return new ApiError(422, general ?? "Please fix the highlighted fields.", fieldErrors);
  }
  if (typeof detail === "string") return new ApiError(status, detail);
  return new ApiError(
    status,
    status >= 500 ? "Something went wrong. Please try again." : "Request failed.",
  );
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers: initHeaders, ...init } = options;
  const headers = new Headers(initHeaders);
  const token = await getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let markedSlow = false;
  const slowTimer = setTimeout(() => {
    markedSlow = true;
    bumpSlow(1);
  }, SLOW_MS);

  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, { ...init, headers, body, signal: controller.signal });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(
      0,
      timedOut
        ? "The server took too long to respond. Please try again."
        : "Network error. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timeout);
    clearTimeout(slowTimer);
    if (markedSlow) bumpSlow(-1);
  }

  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, data);
  return data as T;
}
