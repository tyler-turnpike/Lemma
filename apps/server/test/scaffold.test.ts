import { describe, expect, it } from "vitest";

import { SERVER_COMPONENT } from "../src/component.js";

describe("server component", () => {
  it("exports its component identity", () => {
    expect(SERVER_COMPONENT).toEqual({
      name: "@lemma/server",
      status: "implemented",
    });
  });
});
