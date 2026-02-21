/**
 * Protocol type guard tests
 *
 * Tests isHelloMessage, isClientMessage, createError, and
 * createIncompatibleProtocolError from the protocol package.
 */

import { describe, it, expect } from "vitest";
import { isHelloMessage, isClientMessage } from "../src/types.js";
import { createError, createIncompatibleProtocolError } from "../src/errors.js";

// =============================================================================
// isHelloMessage
// =============================================================================

describe("isHelloMessage", () => {
  it("accepts a valid HelloMessage", () => {
    const msg = { type: "hello", protocolVersion: 1, clientId: "abc-123" };
    expect(isHelloMessage(msg)).toBe(true);
  });

  it("accepts a valid HelloMessage with optional token", () => {
    const msg = { type: "hello", protocolVersion: 1, clientId: "abc-123", token: "secret" };
    expect(isHelloMessage(msg)).toBe(true);
  });

  it("accepts a valid HelloMessage with extra fields", () => {
    const msg = { type: "hello", protocolVersion: 1, clientId: "abc-123", extra: "ignored" };
    expect(isHelloMessage(msg)).toBe(true);
  });

  it("rejects missing protocolVersion", () => {
    const msg = { type: "hello", clientId: "abc-123" };
    expect(isHelloMessage(msg)).toBe(false);
  });

  it("rejects missing clientId", () => {
    const msg = { type: "hello", protocolVersion: 1 };
    expect(isHelloMessage(msg)).toBe(false);
  });

  it("rejects wrong type tag", () => {
    const msg = { type: "hi", protocolVersion: 1, clientId: "abc-123" };
    expect(isHelloMessage(msg)).toBe(false);
  });

  it("rejects protocolVersion as string instead of number", () => {
    const msg = { type: "hello", protocolVersion: "1", clientId: "abc-123" };
    expect(isHelloMessage(msg)).toBe(false);
  });

  it("rejects clientId as number instead of string", () => {
    const msg = { type: "hello", protocolVersion: 1, clientId: 42 };
    expect(isHelloMessage(msg)).toBe(false);
  });

  it("rejects null", () => {
    expect(isHelloMessage(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isHelloMessage(undefined)).toBe(false);
  });

  it("rejects arrays", () => {
    expect(isHelloMessage([])).toBe(false);
    expect(isHelloMessage([1, 2, 3])).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isHelloMessage(42)).toBe(false);
    expect(isHelloMessage("hello")).toBe(false);
    expect(isHelloMessage(true)).toBe(false);
  });

  it("rejects empty object", () => {
    expect(isHelloMessage({})).toBe(false);
  });
});

// =============================================================================
// isClientMessage
// =============================================================================

describe("isClientMessage", () => {
  describe("command variant", () => {
    it("accepts valid ClientCommandMessage", () => {
      const msg = { type: "command", payload: { type: "prompt", message: "hello" } };
      expect(isClientMessage(msg)).toBe(true);
    });

    it("accepts ClientCommandMessage with extra fields", () => {
      const msg = { type: "command", payload: { type: "prompt" }, extra: true };
      expect(isClientMessage(msg)).toBe(true);
    });

    it("rejects command with missing payload", () => {
      const msg = { type: "command" };
      expect(isClientMessage(msg)).toBe(false);
    });

    it("rejects command with null payload", () => {
      const msg = { type: "command", payload: null };
      expect(isClientMessage(msg)).toBe(false);
    });

    it("rejects command with string payload", () => {
      const msg = { type: "command", payload: "not-an-object" };
      expect(isClientMessage(msg)).toBe(false);
    });
  });

  describe("extension_ui_response variant", () => {
    it("accepts valid ClientExtensionUIResponse with value", () => {
      const msg = { type: "extension_ui_response", id: "req-1", value: "option_a" };
      expect(isClientMessage(msg)).toBe(true);
    });

    it("accepts valid ClientExtensionUIResponse with confirmed", () => {
      const msg = { type: "extension_ui_response", id: "req-1", confirmed: true };
      expect(isClientMessage(msg)).toBe(true);
    });

    it("accepts valid ClientExtensionUIResponse with cancelled", () => {
      const msg = { type: "extension_ui_response", id: "req-1", cancelled: true };
      expect(isClientMessage(msg)).toBe(true);
    });

    it("rejects extension_ui_response with missing id", () => {
      const msg = { type: "extension_ui_response", value: "option_a" };
      expect(isClientMessage(msg)).toBe(false);
    });

    it("rejects extension_ui_response with numeric id", () => {
      const msg = { type: "extension_ui_response", id: 42 };
      expect(isClientMessage(msg)).toBe(false);
    });
  });

  describe("ping variant", () => {
    it("accepts valid ClientPing", () => {
      const msg = { type: "ping" };
      expect(isClientMessage(msg)).toBe(true);
    });

    it("accepts ping with extra fields", () => {
      const msg = { type: "ping", ts: Date.now() };
      expect(isClientMessage(msg)).toBe(true);
    });
  });

  describe("rejections", () => {
    it("rejects unknown type", () => {
      const msg = { type: "unknown" };
      expect(isClientMessage(msg)).toBe(false);
    });

    it("rejects null", () => {
      expect(isClientMessage(null)).toBe(false);
    });

    it("rejects undefined", () => {
      expect(isClientMessage(undefined)).toBe(false);
    });

    it("rejects arrays", () => {
      expect(isClientMessage([])).toBe(false);
    });

    it("rejects primitives", () => {
      expect(isClientMessage(42)).toBe(false);
      expect(isClientMessage("ping")).toBe(false);
    });

    it("rejects empty object", () => {
      expect(isClientMessage({})).toBe(false);
    });
  });
});

// =============================================================================
// createError
// =============================================================================

describe("createError", () => {
  it("creates a ServerError with required fields", () => {
    const error = createError("INTERNAL_ERROR", "Something went wrong");
    expect(error.type).toBe("error");
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).toBe("Something went wrong");
  });

  it("does not include serverVersion when not provided", () => {
    const error = createError("INVALID_HELLO", "Bad hello");
    expect(error.serverVersion).toBeUndefined();
  });

  it("includes serverVersion when provided", () => {
    const error = createError("INCOMPATIBLE_PROTOCOL", "Version mismatch", 42);
    expect(error.serverVersion).toBe(42);
  });

  it("works for all ErrorCode values", () => {
    const codes = [
      "INCOMPATIBLE_PROTOCOL",
      "INVALID_HELLO",
      "UNAUTHORIZED",
      "SESSION_NOT_FOUND",
      "PI_PROCESS_ERROR",
      "EXTENSION_UI_TIMEOUT",
      "INTERNAL_ERROR",
    ] as const;

    for (const code of codes) {
      const error = createError(code, "test");
      expect(error.type).toBe("error");
      expect(error.code).toBe(code);
    }
  });
});

// =============================================================================
// createIncompatibleProtocolError
// =============================================================================

describe("createIncompatibleProtocolError", () => {
  it("creates INCOMPATIBLE_PROTOCOL error", () => {
    const error = createIncompatibleProtocolError(2, 1);
    expect(error.type).toBe("error");
    expect(error.code).toBe("INCOMPATIBLE_PROTOCOL");
  });

  it("includes both versions in the message", () => {
    const error = createIncompatibleProtocolError(2, 1);
    expect(error.message).toContain("1"); // server version
    expect(error.message).toContain("2"); // client version
  });

  it("includes serverVersion field", () => {
    const error = createIncompatibleProtocolError(2, 1);
    expect(error.serverVersion).toBe(1);
  });

  it("works when client is behind server", () => {
    const error = createIncompatibleProtocolError(1, 3);
    expect(error.code).toBe("INCOMPATIBLE_PROTOCOL");
    expect(error.serverVersion).toBe(3);
  });
});
