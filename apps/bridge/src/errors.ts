/** Explicit, secret-free error surfaced to the coding agent. */
export type BridgeErrorCode =
  | "config"
  | "profile"
  | "remote"
  | "policy"
  | "payment"
  | "verification"
  | "recovery"
  | "activation"
  | "apply"
  | "acceptance"
  | "state"
  | "not-found";

export class BridgeError extends Error {
  override name = "BridgeError";
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof BridgeError) {
    return error.details.length > 0 ? `${error.message}: ${error.details.join("; ")}` : error.message;
  }
  if (error instanceof Error) {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    return typeof short === "string" && short.length > 0 ? short : error.message;
  }
  return String(error);
}
