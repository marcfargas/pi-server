/**
 * UIBridge tests — extension UI request routing, timeouts, concurrency.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UIBridge } from "../src/ui-bridge.js";

// =============================================================================
// isExtensionUIRequest
// =============================================================================

describe("isExtensionUIRequest", () => {
  it("returns true for type: extension_ui_request", () => {
    const bridge = new UIBridge();
    expect(bridge.isExtensionUIRequest({ type: "extension_ui_request", id: "1", method: "notify" })).toBe(true);
  });

  it("returns false for other message types", () => {
    const bridge = new UIBridge();
    expect(bridge.isExtensionUIRequest({ type: "event" })).toBe(false);
    expect(bridge.isExtensionUIRequest({ type: "response" })).toBe(false);
    expect(bridge.isExtensionUIRequest({ type: "command" })).toBe(false);
    expect(bridge.isExtensionUIRequest({})).toBe(false);
  });
});

// =============================================================================
// isFireAndForget
// =============================================================================

describe("isFireAndForget", () => {
  it("returns true for notify", () => {
    const bridge = new UIBridge();
    expect(bridge.isFireAndForget({ method: "notify" })).toBe(true);
  });

  it("returns true for setStatus", () => {
    const bridge = new UIBridge();
    expect(bridge.isFireAndForget({ method: "setStatus" })).toBe(true);
  });

  it("returns true for setWidget", () => {
    const bridge = new UIBridge();
    expect(bridge.isFireAndForget({ method: "setWidget" })).toBe(true);
  });

  it("returns true for setTitle", () => {
    const bridge = new UIBridge();
    expect(bridge.isFireAndForget({ method: "setTitle" })).toBe(true);
  });

  it("returns true for set_editor_text", () => {
    const bridge = new UIBridge();
    expect(bridge.isFireAndForget({ method: "set_editor_text" })).toBe(true);
  });

  it("returns false for select", () => {
    const bridge = new UIBridge();
    expect(bridge.isFireAndForget({ method: "select" })).toBe(false);
  });

  it("returns false for confirm", () => {
    const bridge = new UIBridge();
    expect(bridge.isFireAndForget({ method: "confirm" })).toBe(false);
  });

  it("returns false for input", () => {
    const bridge = new UIBridge();
    expect(bridge.isFireAndForget({ method: "input" })).toBe(false);
  });

  it("returns false for editor", () => {
    const bridge = new UIBridge();
    expect(bridge.isFireAndForget({ method: "editor" })).toBe(false);
  });
});

// =============================================================================
// registerRequest + handleResponse
// =============================================================================

describe("registerRequest + handleResponse", () => {
  it("resolves with client response when handleResponse is called", async () => {
    const bridge = new UIBridge(5000);
    const promise = bridge.registerRequest("req-1", "input");

    const clientResponse = { type: "extension_ui_response", id: "req-1", value: "user text" };
    const handled = bridge.handleResponse("req-1", clientResponse);

    expect(handled).toBe(true);
    const result = await promise;
    expect(result).toEqual(clientResponse);
  });

  it("handleResponse returns false for unknown id", () => {
    const bridge = new UIBridge(5000);
    bridge.registerRequest("req-1", "input");
    expect(bridge.handleResponse("req-unknown", { id: "req-unknown" })).toBe(false);
  });

  it("handleResponse returns false after already resolved", async () => {
    const bridge = new UIBridge(5000);
    bridge.registerRequest("req-1", "confirm");
    bridge.handleResponse("req-1", { type: "extension_ui_response", id: "req-1", confirmed: true });
    // Second call for same id should return false (already deleted from map)
    expect(bridge.handleResponse("req-1", { type: "extension_ui_response", id: "req-1", confirmed: true })).toBe(false);
  });
});

// =============================================================================
// Timeout behaviour
// =============================================================================

describe("timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with default cancel response after timeout", async () => {
    const bridge = new UIBridge(1000);
    const promise = bridge.registerRequest("req-1", "select");

    vi.runAllTimers();

    const result = await promise;
    expect(result).toEqual({ type: "extension_ui_response", id: "req-1", cancelled: true });
  });

  it("removes request from pending map after timeout", async () => {
    const bridge = new UIBridge(1000);
    bridge.registerRequest("req-1", "select");

    expect(bridge.hasPendingRequests()).toBe(true);
    vi.runAllTimers();
    // Flush the promise resolution
    await Promise.resolve();

    expect(bridge.hasPendingRequests()).toBe(false);
  });
});

// =============================================================================
// cancelAll
// =============================================================================

describe("cancelAll", () => {
  it("resolves all pending requests with defaults", async () => {
    const bridge = new UIBridge(60_000);
    const p1 = bridge.registerRequest("req-1", "select");
    const p2 = bridge.registerRequest("req-2", "confirm");
    const p3 = bridge.registerRequest("req-3", "input");

    bridge.cancelAll();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual({ type: "extension_ui_response", id: "req-1", cancelled: true });
    expect(r2).toEqual({ type: "extension_ui_response", id: "req-2", confirmed: false });
    expect(r3).toEqual({ type: "extension_ui_response", id: "req-3", cancelled: true });
  });

  it("clears pending map after cancelAll", async () => {
    const bridge = new UIBridge(60_000);
    bridge.registerRequest("req-1", "select");
    bridge.registerRequest("req-2", "confirm");

    expect(bridge.hasPendingRequests()).toBe(true);
    bridge.cancelAll();
    await Promise.resolve();

    expect(bridge.hasPendingRequests()).toBe(false);
  });

  it("is idempotent — calling twice does not throw", async () => {
    const bridge = new UIBridge(60_000);
    bridge.registerRequest("req-1", "select");
    bridge.cancelAll();
    expect(() => bridge.cancelAll()).not.toThrow();
  });
});

// =============================================================================
// hasPendingRequests
// =============================================================================

describe("hasPendingRequests", () => {
  it("returns false initially", () => {
    const bridge = new UIBridge();
    expect(bridge.hasPendingRequests()).toBe(false);
  });

  it("returns true after registering a request", () => {
    const bridge = new UIBridge(60_000);
    bridge.registerRequest("req-1", "select");
    expect(bridge.hasPendingRequests()).toBe(true);
  });

  it("returns false after all requests are handled", async () => {
    const bridge = new UIBridge(60_000);
    bridge.registerRequest("req-1", "select");
    bridge.handleResponse("req-1", { type: "extension_ui_response", id: "req-1", cancelled: true });
    await Promise.resolve();
    expect(bridge.hasPendingRequests()).toBe(false);
  });

  it("returns false after cancelAll", async () => {
    const bridge = new UIBridge(60_000);
    bridge.registerRequest("req-1", "select");
    bridge.cancelAll();
    await Promise.resolve();
    expect(bridge.hasPendingRequests()).toBe(false);
  });
});

// =============================================================================
// Concurrent requests
// =============================================================================

describe("concurrent requests", () => {
  it("handles multiple pending requests independently", async () => {
    const bridge = new UIBridge(60_000);
    const p1 = bridge.registerRequest("req-1", "select");
    const p2 = bridge.registerRequest("req-2", "confirm");
    const p3 = bridge.registerRequest("req-3", "input");

    // Resolve in different order
    bridge.handleResponse("req-3", { type: "extension_ui_response", id: "req-3", value: "typed" });
    bridge.handleResponse("req-1", { type: "extension_ui_response", id: "req-1", cancelled: true });
    bridge.handleResponse("req-2", { type: "extension_ui_response", id: "req-2", confirmed: true });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect((r1 as Record<string, unknown>).cancelled).toBe(true);
    expect((r2 as Record<string, unknown>).confirmed).toBe(true);
    expect((r3 as Record<string, unknown>).value).toBe("typed");
  });

  it("tracks count correctly as requests come and go", () => {
    const bridge = new UIBridge(60_000);
    expect(bridge.hasPendingRequests()).toBe(false);

    bridge.registerRequest("req-1", "select");
    expect(bridge.hasPendingRequests()).toBe(true);

    bridge.registerRequest("req-2", "confirm");
    expect(bridge.hasPendingRequests()).toBe(true);

    bridge.handleResponse("req-1", { id: "req-1", cancelled: true });
    expect(bridge.hasPendingRequests()).toBe(true); // req-2 still pending

    bridge.handleResponse("req-2", { id: "req-2", confirmed: false });
    expect(bridge.hasPendingRequests()).toBe(false);
  });
});

// =============================================================================
// Default responses per method
// =============================================================================

describe("default responses per method", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("select → cancelled: true", async () => {
    const bridge = new UIBridge(1000);
    const p = bridge.registerRequest("id", "select");
    vi.runAllTimers();
    const result = await p;
    expect(result).toMatchObject({ cancelled: true });
  });

  it("confirm → confirmed: false", async () => {
    const bridge = new UIBridge(1000);
    const p = bridge.registerRequest("id", "confirm");
    vi.runAllTimers();
    const result = await p;
    expect(result).toMatchObject({ confirmed: false });
  });

  it("input → cancelled: true", async () => {
    const bridge = new UIBridge(1000);
    const p = bridge.registerRequest("id", "input");
    vi.runAllTimers();
    const result = await p;
    expect(result).toMatchObject({ cancelled: true });
  });

  it("editor → cancelled: true", async () => {
    const bridge = new UIBridge(1000);
    const p = bridge.registerRequest("id", "editor");
    vi.runAllTimers();
    const result = await p;
    expect(result).toMatchObject({ cancelled: true });
  });

  it("unknown method → cancelled: true (fallback)", async () => {
    const bridge = new UIBridge(1000);
    const p = bridge.registerRequest("id", "unknown_method");
    vi.runAllTimers();
    const result = await p;
    expect(result).toMatchObject({ cancelled: true });
  });
});
