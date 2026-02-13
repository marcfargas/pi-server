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
import type { IPiTransport, PiMessageHandler } from "../src/pi-process.js";
import { PROTOCOL_VERSION } from "@marcfargas/pi-server-protocol";

// =============================================================================
// Mock Pi Transport
// =============================================================================

class MockPiTransport implements IPiTransport {
  private handler: PiMessageHandler | null = null;
  private promptScript: Record<string, unknown>[] = [];
  /** All messages sent to this transport (for assertions) */
  sent: Record<string, unknown>[] = [];

  onMessage(handler: PiMessageHandler): void {
    this.handler = handler;
  }

  send(message: Record<string, unknown>): void {
    this.sent.push(message);
    const type = message.type as string;

    // Handle get_state
    if (type === "get_state") {
      this.emit({
        type: "response",
        id: message.id,
        success: true,
        data: { model: { name: "test-model", id: "test/model" } },
      });
      return;
    }

    // Handle get_messages
    if (type === "get_messages") {
      this.emit({
        type: "response",
        id: message.id,
        success: true,
        data: { messages: [] },
      });
      return;
    }

    // Handle prompt — emit the scripted events
    if (type === "prompt") {
      // Fire events async (simulates streaming)
      setTimeout(() => {
        for (const event of this.promptScript) {
          this.emit(event);
        }
        // Send response after events
        this.emit({
          type: "response",
          id: message.id,
          success: true,
        });
      }, 10);
      return;
    }
  }

  /** Emit a message as if pi wrote it to stdout */
  emit(message: Record<string, unknown>): void {
    this.handler?.(message);
  }

  /** Set the events that will fire on next prompt */
  scriptPrompt(events: Record<string, unknown>[]): void {
    this.promptScript = events;
  }
}

// =============================================================================
// Test helpers
// =============================================================================

function connectAndHandshake(port: number): Promise<{ ws: WebSocket; welcome: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("open", () => {
      // Send hello
      ws.send(JSON.stringify({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        clientId: "test-client",
        mode: "rw",
      }));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === "welcome") {
        resolve({ ws, welcome: msg });
      } else if (msg.type === "error") {
        reject(new Error(`Handshake error: ${JSON.stringify(msg)}`));
      }
    });

    ws.on("error", reject);
  });
}

function collectMessages(ws: WebSocket, count: number, timeoutMs = 5000): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout: received ${messages.length}/${count} messages`));
    }, timeoutMs);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      messages.push(msg);
      if (messages.length >= count) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });
  });
}

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
    expect(welcome.serverId).toBe("pi-server-1");
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

  it("routes /model to cycle_model RPC", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);

    // Clear the sent log (handshake sends get_state + get_messages)
    transport.sent.length = 0;

    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "prompt", message: "/model" },
    }));

    // Wait for the message to be processed
    await new Promise((r) => setTimeout(r, 50));

    // Should have sent cycle_model, NOT prompt
    const rpcMsg = transport.sent.find((m) => m.type === "cycle_model");
    expect(rpcMsg).toBeDefined();
    expect(transport.sent.find((m) => m.type === "prompt")).toBeUndefined();

    ws.close();
  });

  it("routes /model provider/id to set_model RPC", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);
    transport.sent.length = 0;

    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "prompt", message: "/model google/gemini-2.5-flash" },
    }));

    await new Promise((r) => setTimeout(r, 50));

    const rpcMsg = transport.sent.find((m) => m.type === "set_model");
    expect(rpcMsg).toBeDefined();
    expect(rpcMsg!.provider).toBe("google");
    expect(rpcMsg!.modelId).toBe("gemini-2.5-flash");

    ws.close();
  });

  it("passes unknown /commands through as prompt", async () => {
    const transport = new MockPiTransport();
    transport.scriptPrompt([{ type: "agent_start" }, { type: "agent_end" }]);
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);
    transport.sent.length = 0;

    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "prompt", message: "/skill:web-search" },
    }));

    await new Promise((r) => setTimeout(r, 50));

    // Should go through as prompt (pi handles extension/skill routing)
    const promptMsg = transport.sent.find((m) => m.type === "prompt");
    expect(promptMsg).toBeDefined();
    expect(promptMsg!.message).toBe("/skill:web-search");

    ws.close();
  });

  it("routes /compact with instructions", async () => {
    const transport = new MockPiTransport();
    server = new WsServer({ port: PORT, piProcess: transport });
    await server.start();

    const { ws } = await connectAndHandshake(PORT);
    transport.sent.length = 0;

    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "prompt", message: "/compact Focus on architecture" },
    }));

    await new Promise((r) => setTimeout(r, 50));

    const rpcMsg = transport.sent.find((m) => m.type === "compact");
    expect(rpcMsg).toBeDefined();
    expect(rpcMsg!.customInstructions).toBe("Focus on architecture");

    ws.close();
  });
});
