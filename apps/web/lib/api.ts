export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
  message?: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      // Fastify rejects an empty body when Content-Type is
      // application/json, so only claim JSON when we're actually sending one.
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    let body: ErrorBody = {};
    try {
      body = await res.json();
    } catch {
      // non-JSON error body — fall through to the generic message below
    }
    throw new ApiError(
      res.status,
      body.error?.code ?? "UNKNOWN",
      body.error?.message ?? body.message ?? res.statusText,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

// ADR-002 — this is the only place apps/web talks to @hackpulse/api, always
// through the same-origin /api/v1/* proxy (app/api/v1/[...path]/route.ts),
// never a direct cross-origin fetch. `body ?? {}` sends "{}" for callers
// that omit a body (submit, publish, sign-out): Fastify rejects an empty
// body with Content-Type: application/json, while Better Auth's native
// routes require that header even with nothing to say. "{}" satisfies both.
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
