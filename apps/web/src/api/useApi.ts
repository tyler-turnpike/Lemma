import { useCallback, useEffect, useState } from "react";

import { ApiError, type ApiState } from "./client.js";

/**
 * Runs `load` on mount and whenever `key` changes. Server rendering (and the first client frame)
 * always shows the loading state. `retry` reruns the request.
 */
export function useApi<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): { state: ApiState<T>; retry: () => void } {
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: error instanceof ApiError ? error.failure : { kind: "bad_response" } });
      },
    );
    return () => controller.abort();
    // `load` is recreated each render; the request identity is `key` + `attempt`.
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
