import type { Context, MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

/** Restrictive CSP for the dashboard: same-origin only, no inline script, no framing. */
export const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

export function securityHeaders(options: { https: boolean }): MiddlewareHandler {
  return secureHeaders({
    // upgrade-insecure-requests only when served over HTTPS (it breaks plain-HTTP local dev).
    contentSecurityPolicy: options.https ? { ...CONTENT_SECURITY_POLICY, upgradeInsecureRequests: [] } : CONTENT_SECURITY_POLICY,
    strictTransportSecurity: "max-age=63072000; includeSubDomains",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "no-referrer",
    crossOriginOpenerPolicy: "same-origin",
    crossOriginResourcePolicy: "same-origin",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
  });
}

/** Sensitive responses must never be cached by browsers or proxies. */
export function noStore(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
  };
}

export type ClientIp = (c: Context) => string;

/**
 * Client address for rate limiting. Behind a trusted proxy (Railway) the first
 * X-Forwarded-For hop is used; otherwise the socket address.
 */
export function clientIpResolver(trustProxy: boolean): ClientIp {
  return (c) => {
    if (trustProxy) {
      const xff = c.req.header("x-forwarded-for");
      const first = xff?.split(",")[0]?.trim();
      if (first !== undefined && first.length > 0 && first.length <= 64) return first;
    }
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    return incoming?.socket?.remoteAddress ?? "unknown";
  };
}

/**
 * Fixed-window in-memory rate limiter (single replica). Bounded memory: the table is
 * cleared when a window rolls over.
 */
export function rateLimit(options: { windowMs: number; max: number; clientIp: ClientIp; now?: () => number; name: string }): MiddlewareHandler {
  const now = options.now ?? Date.now;
  let windowStart = now();
  let counts = new Map<string, number>();
  return async (c, next) => {
    const t = now();
    if (t - windowStart >= options.windowMs) {
      windowStart = t;
      counts = new Map();
    }
    const key = options.clientIp(c);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n > options.max) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + options.windowMs - t) / 1000));
      c.header("Retry-After", String(retryAfter));
      c.header("Cache-Control", "no-store");
      return c.json({ error: { code: "rate_limited", message: `too many ${options.name} requests` } }, 429);
    }
    await next();
  };
}
