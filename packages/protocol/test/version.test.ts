/**
 * Protocol version tests
 */

import { describe, it, expect } from "vitest";
import { PROTOCOL_VERSION } from "../src/version.js";

describe("PROTOCOL_VERSION", () => {
  it("is exported", () => {
    expect(PROTOCOL_VERSION).toBeDefined();
  });

  it("is a positive integer", () => {
    expect(typeof PROTOCOL_VERSION).toBe("number");
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it("is currently 1", () => {
    // This test documents the current version — update when bumping.
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
