// Same-origin read-only client for the public API. The base URL may be overridden at build time
// with VITE_LEMMA_API_URL; only a plain public http(s) origin is accepted (no credentials, no path tricks).

import { ParseError } from "./parse.js";

export type ApiFailure =
  /** Network failure or a non-JSON answer (e.g. a static preview with no server behind it). */
  | { readonly kind: "offline" }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_input" }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "unavailable"; readonly status: number; readonly code: string | null }
  | { readonly kind: "bad_response" };

export type ApiState<T> =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: ApiFailure }
  | { readonly status: "ready"; readonly data: T };

export class ApiError extends Error {
  override name = "ApiError";
  constructor(readonly failure: ApiFailure) {
    super(failure.kind);
  }
}

/** Validates a configured API base; returns "" (same origin) when absent or unacceptable. */
export function resolveApiBase(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") return "";
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) return "";
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return "";
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const env = (import.meta as { env?: Record<string, unknown> }).env ?? {};
export const API_BASE = resolveApiBase(env.VITE_LEMMA_API_URL);

const MAX_BODY_BYTES = 1_000_000;

function codeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : null;
}

/** GET a JSON endpoint and run it through `parse`. Throws ApiError with a classified failure. */
export async function getJson<T>(
  path: string,
  parse: (body: unknown) => T,
  options: { readonly signal?: AbortSignal; readonly fetchImpl?: typeof fetch; readonly base?: string } = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${options.base ?? API_BASE}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError({ kind: "offline" });
  }

  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    // Static hosting answers with index.html; a dev proxy without a server answers 5xx text.
    throw new ApiError({ kind: "offline" });
  }
  let body: unknown;
  try {
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES) throw new ApiError({ kind: "bad_response" });
    body = JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError({ kind: "bad_response" });
  }

  if (!response.ok) {
    const code = codeOf(body);
    if (response.status === 404 || code === "not_found") throw new ApiError({ kind: "not_found" });
    if (response.status === 400 || code === "invalid_input") throw new ApiError({ kind: "invalid_input" });
    if (response.status === 429) throw new ApiError({ kind: "rate_limited" });
    throw new ApiError({ kind: "unavailable", status: response.status, code });
  }
  try {
    return parse(body);
  } catch (error) {
    if (error instanceof ParseError) throw new ApiError({ kind: "bad_response" });
    throw error;
  }
}

/** Fetches `path` and reports the raw HTTP outcome without parsing (used for health probes). */
export async function probe(
  path: string,
  options: { readonly signal?: AbortSignal; readonly fetchImpl?: typeof fetch; readonly base?: string } = {},
): Promise<{ readonly ok: boolean; readonly status: number; readonly body: unknown } | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${options.base ?? API_BASE}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!(response.headers.get("content-type") ?? "").includes("application/json")) return null;
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text.length > MAX_BODY_BYTES ? null : (JSON.parse(text) as unknown) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}
