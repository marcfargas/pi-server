/**
 * Server error path tests
 *
 * Tests protocol error handling: invalid JSON, bad handshakes,
 * version mismatches, duplicate clients, and graceful shutdown.
 */

import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { WsServer } from "../src/ws-server.js";
import { PROTOCOL_VERSION } from "@marcfargas/pi-server-protocol";
import { MockPiTransport, connectAndHandshake } from "./helpers.js";

const PORT = 19878; // distinct from relay.test.ts (19876)

let server: WsServer | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

// =============================================================================
// Helpers
// =============================================================================

function openSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

/** Read the next message from a WebSocket */
function nextMessage(ws: WebSocket, timeoutMs = 3000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("nextMessage timeout")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(t);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    });
  });
}

/** Wait for the WebSocket close event */
function waitClose(ws: WebSocket, timeoutMs = 3000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("waitClose timeout")), timeoutMs);
    ws.once("close", (code, reason) => {
      clearTimeout(t);
      resolve({ code, reason: reason.toString() });
    });
  });
}

// =============================================================================
// Invalid JSON
// =============================================================================

describe("invalid JSON", () => {
  it("sends error response and keeps connection open", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const ws = await openSocket(PORT);

    const msgPromise = nextMessage(ws, 2000);
    ws.send("not valid json {{{{");
    const response = await msgPromise;

    expect(response.type).toBe("error");
    expect(response.code).toBe("INTERNAL_ERROR");
    expect(response.message).toContain("Invalid JSON");

    // Connection should still be open
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });
});

// =============================================================================
// Non-hello first message → INVALID_HELLO
// =============================================================================

describe("non-hello first message", () => {
  it("sends INVALID_HELLO error and closes connection", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const ws = await openSocket(PORT);

    const closePromise = waitClose(ws);
    const msgPromise = nextMessage(ws, 2000);

    // Send a valid-JSON but non-hello message as the first message
    ws.send(JSON.stringify({ type: "command", payload: { type: "prompt" } }));

    const response = await msgPromise;
    expect(response.type).toBe("error");
    expect(response.code).toBe("INVALID_HELLO");

    const { code } = await closePromise;
    expect(code).toBe(1002);
  });

  it("rejects a plain object without type as first message", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const ws = await openSocket(PORT);

    const closePromise = waitClose(ws);
    const msgPromise = nextMessage(ws, 2000);

    ws.send(JSON.stringify({ message: "hello without type" }));

    const response = await msgPromise;
    expect(response.type).toBe("error");
    expect(response.code).toBe("INVALID_HELLO");

    await closePromise;
  });
});

// =============================================================================
// Wrong protocol version → INCOMPATIBLE_PROTOCOL
// =============================================================================

describe("wrong protocol version", () => {
  it("sends INCOMPATIBLE_PROTOCOL error and closes connection", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const ws = await openSocket(PORT);

    const closePromise = waitClose(ws);
    const msgPromise = nextMessage(ws, 2000);

    ws.send(JSON.stringify({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION + 999, // definitely wrong
      clientId: "test-client",
    }));

    const response = await msgPromise;
    expect(response.type).toBe("error");
    expect(response.code).toBe("INCOMPATIBLE_PROTOCOL");
    expect(response.serverVersion).toBe(PROTOCOL_VERSION);

    const { code } = await closePromise;
    expect(code).toBe(1002);
  });

  it("includes server version in error so client can report it", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const ws = await openSocket(PORT);

    const msgPromise = nextMessage(ws, 2000);
    ws.send(JSON.stringify({
      type: "hello",
      protocolVersion: 0,
      clientId: "old-client",
    }));

    const response = await msgPromise;
    expect(response.serverVersion).toBe(PROTOCOL_VERSION);
    ws.close();
  });
});

// =============================================================================
// Two simultaneous clients → second rejected
// =============================================================================

describe("two clients connect simultaneously", () => {
  it("first client succeeds, second gets rejection and closes", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    // First client completes handshake
    const { ws: ws1 } = await connectAndHandshake(PORT);

    // Second client: register listeners BEFORE connection opens to avoid a
    // race where the server's rejection message arrives in the same event
    // loop tick as the "open" event (both driven by the same socket data).
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("second-client timeout")), 3000);
      const ws2 = new WebSocket(`ws://localhost:${PORT}`);
      let receivedMsg: Record<string, unknown> | null = null;

      ws2.on("message", (data) => {
        receivedMsg = JSON.parse(data.toString()) as Record<string, unknown>;
      });

      ws2.on("close", () => {
        clearTimeout(timer);
        try {
          expect(receivedMsg).not.toBeNull();
          expect(receivedMsg!.type).toBe("error");
          // First client must still be connected
          expect(ws1.readyState).toBe(WebSocket.OPEN);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      ws2.on("error", reject);
    });

    ws1.close();
  });

  it("after first client disconnects, new client can connect", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws: ws1 } = await connectAndHandshake(PORT);
    ws1.close();

    // Wait for disconnect to propagate
    await new Promise((r) => setTimeout(r, 50));

    // New client should succeed
    const { ws: ws2, welcome } = await connectAndHandshake(PORT);
    expect(welcome.type).toBe("welcome");

    ws2.close();
  });
});

// =============================================================================
// Server stop() → client connection closed cleanly
// =============================================================================

describe("server stop()", () => {
  it("closes connected client with code 1001", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);
    const closePromise = waitClose(ws);

    await server.stop();
    server = null; // prevent double-stop in afterEach

    const { code } = await closePromise;
    expect(code).toBe(1001);
  });

  it("does not throw when no client is connected", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    await expect(server.stop()).resolves.toBeUndefined();
    server = null;
  });
});

// =============================================================================
// Post-handshake message validation (Task 9)
// =============================================================================

describe("post-handshake message validation", () => {
  it("command message without payload gets INTERNAL_ERROR, connection stays open", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);

    const msgPromise = nextMessage(ws, 2000);
    ws.send(JSON.stringify({ type: "command" })); // missing payload

    const response = await msgPromise;
    expect(response.type).toBe("error");
    expect(response.code).toBe("INTERNAL_ERROR");
    expect(response.message).toContain("Invalid message format");

    // Connection should still be open
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("unknown message type gets INTERNAL_ERROR, connection stays open", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);

    const msgPromise = nextMessage(ws, 2000);
    ws.send(JSON.stringify({ type: "nonsense", data: "whatever" }));

    const response = await msgPromise;
    expect(response.type).toBe("error");
    expect(response.code).toBe("INTERNAL_ERROR");
    expect(response.message).toContain("Invalid message format");

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});

// =============================================================================
// CSWSH: Origin header rejection (Task 10)
// =============================================================================

describe("Origin header rejection", () => {
  it("rejects connection with Origin header (CSWSH defense)", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Origin rejection timeout")), 3000);
      const ws = new WebSocket(`ws://localhost:${PORT}`, {
        headers: { Origin: "http://evil.com" },
      });

      ws.on("close", (code) => {
        clearTimeout(timer);
        try {
          expect(code).toBe(1008);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      ws.on("error", () => {
        // Connection may be refused at TCP level — that's also acceptable
        clearTimeout(timer);
        resolve();
      });
    });
  });
});
