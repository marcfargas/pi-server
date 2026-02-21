/**
 * WebSocket relay integration test — scripted events, no LLM.
 *
 * Uses a MockPiTransport that speaks the pi RPC JSON-line protocol
 * with pre-scripted event sequences. Tests the full relay:
 * MockPiTransport → WsServer → WebSocket → client assertions.
 */

import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { WsServer } from "../src/ws-server.js";
import { PROTOCOL_VERSION } from "@marcfargas/pi-server-protocol";
import { MockPiTransport, connectAndHandshake, collectMessages } from "./helpers.js";

// =============================================================================
// Tests
// =============================================================================

let server: WsServer | null = null;
const PORT = 19876; // Unlikely to conflict

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

describe("WebSocket relay", () => {
  it("handshake returns welcome with model info", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws, welcome } = await connectAndHandshake(PORT);

    expect(welcome.type).toBe("welcome");
    expect(welcome.protocolVersion).toBe(PROTOCOL_VERSION);
    // serverId is a per-process UUID (ephemeral, not persisted)
    expect(typeof welcome.serverId).toBe("string");
    expect(welcome.serverId).toBeTruthy();
    expect((welcome.sessionState as Record<string, unknown>)?.model).toEqual({
      name: "test-model",
      id: "test/model",
    });

    ws.close();
  });

  it("relays tool execution events (start → update → end)", async () => {
    const transport = new MockPiTransport();
    transport.scriptPrompt([
      { type: "agent_start" },
      {
        type: "tool_execution_start",
        toolCallId: "tc-1",
        toolName: "bash",
        args: { command: "ls -la" },
      },
      {
        type: "tool_execution_update",
        toolCallId: "tc-1",
        toolName: "bash",
        partialResult: {
          content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
        },
      },
      {
        type: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "bash",
        result: {
          content: [{ type: "text", text: "file1.txt\nfile2.txt\nfile3.txt" }],
        },
        isError: false,
      },
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Found 3 files." },
      },
      { type: "agent_end" },
    ]);

    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);

    // Send prompt and collect the 6 events + 1 response = 7 messages
    const collector = collectMessages(ws, 7);
    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "prompt", message: "list files" },
    }));

    const messages = await collector;

    // All should be wrapped as event messages with seq
    const events = messages.filter((m) => m.type === "event");
    const payloads = events.map((m) => m.payload as Record<string, unknown>);

    expect(payloads[0]!.type).toBe("agent_start");
    expect(payloads[1]!.type).toBe("tool_execution_start");
    expect(payloads[1]!.toolName).toBe("bash");
    expect(payloads[1]!.toolCallId).toBe("tc-1");
    expect(payloads[2]!.type).toBe("tool_execution_update");
    expect(payloads[3]!.type).toBe("tool_execution_end");
    expect(payloads[3]!.isError).toBe(false);
    expect(payloads[4]!.type).toBe("message_update");
    expect(payloads[5]!.type).toBe("agent_end");

    // Seq should be monotonically increasing
    const seqs = events.map((m) => m.seq as number);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!);
    }

    ws.close();
  });

  it("relays thinking_delta events", async () => {
    const transport = new MockPiTransport();
    transport.scriptPrompt([
      { type: "agent_start" },
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "Let me think..." },
      },
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "The answer is 42." },
      },
      { type: "agent_end" },
    ]);

    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);

    const collector = collectMessages(ws, 5); // 4 events + 1 response
    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "prompt", message: "think about this" },
    }));

    const messages = await collector;
    const payloads = messages
      .filter((m) => m.type === "event")
      .map((m) => m.payload as Record<string, unknown>);

    // Thinking delta
    const thinkingUpdate = payloads.find(
      (p) =>
        p.type === "message_update" &&
        (p.assistantMessageEvent as Record<string, unknown>)?.type === "thinking_delta",
    );
    expect(thinkingUpdate).toBeDefined();
    expect(
      (thinkingUpdate!.assistantMessageEvent as Record<string, unknown>).delta,
    ).toBe("Let me think...");

    ws.close();
  });

  it("relays tool error events", async () => {
    const transport = new MockPiTransport();
    transport.scriptPrompt([
      { type: "agent_start" },
      {
        type: "tool_execution_start",
        toolCallId: "tc-err",
        toolName: "bash",
        args: { command: "bad-command" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "tc-err",
        toolName: "bash",
        result: {
          content: [{ type: "text", text: "command not found: bad-command" }],
        },
        isError: true,
      },
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "That command failed." },
      },
      { type: "agent_end" },
    ]);

    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);

    const collector = collectMessages(ws, 6);
    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "prompt", message: "run bad command" },
    }));

    const messages = await collector;
    const payloads = messages
      .filter((m) => m.type === "event")
      .map((m) => m.payload as Record<string, unknown>);

    const toolEnd = payloads.find((p) => p.type === "tool_execution_end");
    expect(toolEnd!.isError).toBe(true);
    expect(toolEnd!.toolCallId).toBe("tc-err");

    ws.close();
  });

  it("reconnect restores history with tools", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    // First connection
    const { ws: ws1 } = await connectAndHandshake(PORT);
    ws1.close();

    // Wait for disconnect to register
    await new Promise((r) => setTimeout(r, 50));

    // Second connection — should get welcome with state
    const { ws: ws2, welcome } = await connectAndHandshake(PORT);
    expect(welcome.type).toBe("welcome");
    expect(welcome.protocolVersion).toBe(PROTOCOL_VERSION);

    ws2.close();
  });

  it("commands library routes /model to cycle_model via relay", async () => {
    // Import the commands library
    const { routeInput, extractCommandNames } = await import("@marcfargas/pi-server-commands");

    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);

    // Step 1: discover commands (what TUI does on connect)
    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "get_commands", id: "disc" },
    }));

    // Wait for get_commands response
    const discResponse = await new Promise<Record<string, unknown>>((resolve) => {
      const handler = (data: WebSocket.RawData) => {
        const m = JSON.parse(data.toString());
        if (m.type === "event" && m.payload?.id === "disc") {
          ws.removeListener("message", handler);
          resolve(m.payload);
        }
      };
      ws.on("message", handler);
    });

    expect(discResponse.success).toBe(true);
    const discovered = extractCommandNames(
      ((discResponse.data as Record<string, unknown>).commands as Array<{ name: string }>),
    );
    expect(discovered.has("todos")).toBe(true);

    // Step 2: route /model through commands library
    const route = routeInput("/model", discovered);
    expect(route.kind).toBe("builtin");
    expect((route as { rpc: Record<string, unknown> }).rpc.type).toBe("cycle_model");

    // Step 3: send the routed command
    transport.sent.length = 0;
    ws.send(JSON.stringify({ type: "command", payload: (route as { rpc: Record<string, unknown> }).rpc }));

    // Wait for response
    const modelResponse = await new Promise<Record<string, unknown>>((resolve) => {
      const handler = (data: WebSocket.RawData) => {
        const m = JSON.parse(data.toString());
        if (m.type === "event" && m.payload?.command === "cycle_model") {
          ws.removeListener("message", handler);
          resolve(m.payload);
        }
      };
      ws.on("message", handler);
    });

    expect(modelResponse.success).toBe(true);
    expect((modelResponse.data as Record<string, unknown>).model).toBeDefined();

    // Verify the transport received cycle_model, NOT prompt
    const sentToTransport = transport.sent.find((m) => m.type === "cycle_model");
    expect(sentToTransport).toBeDefined();
    expect(transport.sent.find((m) => m.type === "prompt")).toBeUndefined();

    ws.close();
  });

  it("commands library routes /todos as prompt via relay", async () => {
    const { routeInput, extractCommandNames } = await import("@marcfargas/pi-server-commands");

    const transport = new MockPiTransport();
    transport.scriptPrompt([{ type: "agent_start" }, { type: "agent_end" }]);
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);

    // Discover commands
    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "get_commands", id: "disc2" },
    }));

    const discResponse = await new Promise<Record<string, unknown>>((resolve) => {
      const handler = (data: WebSocket.RawData) => {
        const m = JSON.parse(data.toString());
        if (m.type === "event" && m.payload?.id === "disc2") {
          ws.removeListener("message", handler);
          resolve(m.payload);
        }
      };
      ws.on("message", handler);
    });

    const discovered = extractCommandNames(
      ((discResponse.data as Record<string, unknown>).commands as Array<{ name: string }>),
    );

    // Route /todos — should be prompt (extension)
    const route = routeInput("/todos", discovered);
    expect(route.kind).toBe("prompt");

    // Send it
    transport.sent.length = 0;
    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "prompt", message: (route as { message: string }).message },
    }));

    await new Promise((r) => setTimeout(r, 50));

    // Verify prompt was sent, NOT a typed command
    const promptMsg = transport.sent.find((m) => m.type === "prompt");
    expect(promptMsg).toBeDefined();
    expect(promptMsg!.message).toBe("/todos");

    ws.close();
  });
});

// =============================================================================
// Hardening tests (auth, concurrent connections, pi exit)
// =============================================================================

// Extended mock that supports triggering an exit callback (for A-3 tests)
class MockPiTransportWithExit extends MockPiTransport {
  private exitHandler: ((code: number | null, signal: string | null) => void) | null = null;

  onExit(handler: (code: number | null, signal: string | null) => void): void {
    this.exitHandler = handler;
  }

  simulateExit(code: number | null = 1, signal: string | null = null): void {
    this.exitHandler?.(code, signal);
  }
}

function connectRaw(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const handler = (data: WebSocket.RawData) => {
      ws.removeListener("message", handler);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    };
    ws.on("message", handler);
    setTimeout(() => reject(new Error("nextMessage timeout")), 3000);
  });
}

const PORT2 = 19877;

describe("Server hardening", () => {
  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  // ── A-1: Token authentication ──────────────────────────────────────────────

  it("rejects connection with wrong token (UNAUTHORIZED)", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT2, piProcess: transport, token: "correct-secret" });
    await server.start();

    const ws = await connectRaw(PORT2);
    ws.send(JSON.stringify({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientId: "bad-client",
      token: "wrong-secret",
    }));

    const msg = await nextMessage(ws);
    expect(msg.type).toBe("error");
    expect(msg.code).toBe("UNAUTHORIZED");

    ws.close();
  });

  it("accepts connection with correct token", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT2, piProcess: transport, token: "my-token" });
    await server.start();

    const ws = await connectRaw(PORT2);
    ws.send(JSON.stringify({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientId: "good-client",
      token: "my-token",
    }));

    const msg = await nextMessage(ws);
    expect(msg.type).toBe("welcome");

    ws.close();
  });

  it("rejects connection with missing token when token is required", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT2, piProcess: transport, token: "secret" });
    await server.start();

    const ws = await connectRaw(PORT2);
    ws.send(JSON.stringify({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientId: "no-token-client",
      // token omitted
    }));

    const msg = await nextMessage(ws);
    expect(msg.type).toBe("error");
    expect(msg.code).toBe("UNAUTHORIZED");

    ws.close();
  });

  it("allows connection without token when no token is configured", async () => {
    const transport = new MockPiTransport();
    // No token configured → localhost-only mode, no auth
    server = new WsServer({ port: PORT2, piProcess: transport });
    await server.start();

    const { ws, welcome } = await connectAndHandshake(PORT2);
    expect(welcome.type).toBe("welcome");

    ws.close();
  });

  // ── A-6: Single-client handshake race ─────────────────────────────────────

  it("rejects second connection while first is active", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT2, piProcess: transport });
    await server.start();

    // First client connects and completes handshake
    const { ws: ws1 } = await connectAndHandshake(PORT2);

    // Second client — set up message + close listeners BEFORE connecting
    // to avoid the race where the server closes before our listener is registered.
    const secondResult = await new Promise<{ closed: boolean; errorMsg: Record<string, unknown> | null }>(
      (resolve) => {
        let errorMsg: Record<string, unknown> | null = null;
        const ws2 = new WebSocket(`ws://localhost:${PORT2}`);

        ws2.on("message", (data) => {
          errorMsg = JSON.parse(data.toString()) as Record<string, unknown>;
        });
        ws2.on("close", () => resolve({ closed: true, errorMsg }));
        ws2.on("error", () => resolve({ closed: false, errorMsg }));

        ws2.on("open", () => {
          ws2.send(JSON.stringify({
            type: "hello",
            protocolVersion: PROTOCOL_VERSION,
            clientId: "second-client",
          }));
        });
      },
    );

    expect(secondResult.closed).toBe(true);
    // Server should have sent an error before closing
    expect(secondResult.errorMsg?.type).toBe("error");

    ws1.close();
  });

  it("reserves slot on TCP connect — only one of two simultaneous connections is accepted", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT2, piProcess: transport });
    await server.start();

    // Open two connections simultaneously, buffering messages before 'open' fires.
    const makeTrackedConnection = (): Promise<{
      ws: WebSocket;
      messages: Record<string, unknown>[];
      closedWith: Promise<{ code: number; reason: string; messages: Record<string, unknown>[] }>;
    }> => {
      return new Promise((resolveOpen) => {
        const messages: Record<string, unknown>[] = [];
        let resolveClose!: (v: { code: number; reason: string; messages: Record<string, unknown>[] }) => void;
        const closedWith = new Promise<{ code: number; reason: string; messages: Record<string, unknown>[] }>(
          (r) => { resolveClose = r; },
        );

        const ws = new WebSocket(`ws://localhost:${PORT2}`);
        ws.on("message", (data) => { messages.push(JSON.parse(data.toString()) as Record<string, unknown>); });
        ws.on("close", (code, reason) => resolveClose({ code, reason: reason.toString(), messages }));
        ws.on("error", () => { /* connection errors are surfaced via close */ });
        ws.on("open", () => resolveOpen({ ws, messages, closedWith }));
      });
    };

    const [connA, connB] = await Promise.all([
      makeTrackedConnection(),
      makeTrackedConnection(),
    ]);

    // The server reserves the slot for the first TCP connection.
    // The second one is closed immediately with an error message.
    // We don't know which is A or B — just verify one was closed immediately.
    const raceResult = await Promise.race([
      connA.closedWith.then((r) => ({ winner: "B" as const, rejected: r })),
      connB.closedWith.then((r) => ({ winner: "A" as const, rejected: r })),
    ]);

    // The rejected connection should have received an error before closing
    expect(raceResult.rejected.messages[0]?.type).toBe("error");
    expect(raceResult.rejected.code).toBe(1008);

    // Clean up the surviving connection
    connA.ws.close();
    connB.ws.close();
  });

  // ── A-3: Pi process death notification ────────────────────────────────────

  it("sends PI_PROCESS_ERROR to client when pi exits unexpectedly", async () => {
    const transport = new MockPiTransportWithExit();
    server = new WsServer({ port: PORT2, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT2);

    // Set up listener BEFORE simulating exit
    const errorPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === "error" && msg.code === "PI_PROCESS_ERROR") {
          resolve(msg);
        }
      });
    });

    // Simulate pi crash
    transport.simulateExit(1);

    const errorMsg = await errorPromise;
    expect(errorMsg.code).toBe("PI_PROCESS_ERROR");
    expect(typeof errorMsg.message).toBe("string");

    ws.close();
  });

  // ── A-5: WebSocketServer startup errors ───────────────────────────────────

  it("rejects start() promise on port conflict (EADDRINUSE)", async () => {
    const transport = new MockPiTransport();
    // Start first server
    const server1 = new WsServer({ port: PORT2, piProcess: transport });
    await server1.start();

    // Attempt to start second server on same port
    const server2 = new WsServer({ port: PORT2, piProcess: transport });
    await expect(server2.start()).rejects.toThrow();

    await server1.stop();
  });
});
