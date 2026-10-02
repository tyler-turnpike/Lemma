// Browser-safe public surface of @lemma/core. Node-only helpers live in "@lemma/core/node".
export * from "./constants.js";
export * from "./usdc.js";
export * from "./canonical.js";
export * from "./semver.js";
export * from "./paths.js";
export * from "./schemas.js";
export * from "./policy.js";
export * from "./eip712.js";
export * from "./redact.js";
export * from "./profile.js";
export * from "./bundle.js";

import { LEMMA_SCHEMA_VERSION } from "./constants.js";

export const CORE_COMPONENT = {
  name: "@lemma/core",
  status: "implemented",
  schemaVersion: LEMMA_SCHEMA_VERSION,
} as const;
