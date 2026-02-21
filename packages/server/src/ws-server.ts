/**
 * WebSocket Server + Message Relay
 *
 * Manages WebSocket connections and relays messages between
 * the connected client and the pi child process.
 *
 * Connection lifecycle:
 * 1. Client connects via WebSocket — slot reserved immediately
 * 2. Client sends HelloMessage (token validated if configured)
 * 3. Server validates protocol version
 * 4. Server queries pi for state (get_state + get_messages)
 * 5. Server sends WelcomeMessage with full state
 * 6. Steady-state: relay messages bidirectionally (server-side keepalive ping)
 * 7. On disconnect: cancel pending UI requests, accept new client
 */

import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  isHelloMessage,
  isClientMessage,
  createIncompatibleProtocolError,
  createError,
  type HelloMessage,
  type WelcomeMessage,
  type ServerEventMessage,
  type ServerExtensionUIRequest,
  type ClientMessage,
} from "@marcfargas/pi-server-protocol";
import { type IPiTransport } from "./pi-process.js";
import { UIBridge } from "./ui-bridge.js";

/** Timeout handle stored alongside each pending command so we can clear it on stop. */
interface PendingCommand {
  resolve: (data: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export interface WsServerOptions {
  port: number;
  host?: string;
  token?: string;
  piProcess: IPiTransport;
  extensionUITimeoutMs?: number;
}

/** Stable, ephemeral ID for this server process. */
const SERVER_ID = randomUUID();

export class WsServer {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private seq = 0;
  private uiBridge: UIBridge;
  private piProcess: IPiTransport;
  private port: number;
  private host: string;
  private token: string | undefined;

  /** Whether a graceful shutdown is in progress. */
  private isShuttingDown = false;

  /** Pending pi commands waiting for response (id → PendingCommand). */
  private pendingPiCommands = new Map<string, PendingCommand>();
  private piCommandId = 0;

  /** Keepalive: interval + pending pong timeout per client. */
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: WsServerOptions) {
    this.port = options.port;
    this.host = options.host ?? "127.0.0.1";
    this.token = options.token;
    this.piProcess = options.piProcess;
    this.uiBridge = new UIBridge(options.extensionUITimeoutMs);

    // Handle messages from pi's stdout
    this.piProcess.onMessage((message) => this.handlePiMessage(message));

    // Wire up pi process exit → notify client (A-3)
    if ("onExit" in this.piProcess && typeof this.piProcess.onExit === "function") {
      (this.piProcess as { onExit(cb: (code: number | null, signal: string | null) => void): void }).onExit(
        (code, signal) => this.handlePiExit(code, signal),
      );
    }
  }

  /**
   * Start the WebSocket server.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, host: this.host });

      // A-5: handle startup errors (EADDRINUSE etc.)
      const onError = (err: Error) => {
        this.wss?.close();
        reject(err);
      };

      this.wss.once("error", onError);

      this.wss.once("listening", () => {
        this.wss!.removeListener("error", onError);
        resolve();
      });

      this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
    });
  }

  /**
   * Stop the server and close all connections.
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;

    // A-8: reject all pending pi commands
    for (const [, pending] of this.pendingPiCommands) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Server stopping"));
    }
    this.pendingPiCommands.clear();

    this.uiBridge.cancelAll();
    this.stopKeepalive();

    if (this.client) {
      this.client.close(1001, "Server shutting down");
      this.client = null;
    }

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ===========================================================================
  // WebSocket connection handling
  // ===========================================================================

  private handleConnection(ws: WebSocket, req: import("node:http").IncomingMessage): void {
    // CSWSH defense: reject connections from browsers (Origin header present).
    // Native WS clients (Node, native apps) never send Origin.
    const origin = req.headers.origin;
    if (origin) {
      ws.close(1008, "Browser Origin rejected");
      return;
    }

    // A-6: Reserve slot immediately on TCP connect (before hello).
    // This prevents two simultaneous connections both passing the check.
    if (this.client) {
      const error = createError("INTERNAL_ERROR", "Another client is already connected");
      ws.send(JSON.stringify(error));
      ws.close(1008, "Another client is already connected");
      return;
    }

    // Reserve the slot right now with the incoming socket.
    this.client = ws;

    let handshakeComplete = false;

    ws.on("message", async (data) => {
      // Guard: only process messages from the currently active socket.
      if (this.client !== ws) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        const error = createError("INTERNAL_ERROR", "Invalid JSON");
        ws.send(JSON.stringify(error));
        return;
      }

      if (!handshakeComplete) {
        // Expect HelloMessage
        if (!isHelloMessage(parsed)) {
          const error = createError("INVALID_HELLO", "First message must be a HelloMessage");
          ws.send(JSON.stringify(error));
          ws.close(1002, "Invalid handshake");
          this.client = null;
          return;
        }

        const hello = parsed as HelloMessage;

        // A-1: Validate token if one is configured
        if (this.token !== undefined) {
          if (hello.token !== this.token) {
            ws.send(JSON.stringify({
              type: "error",
              code: "UNAUTHORIZED",
              message: "Invalid or missing token",
            }));
            ws.close(1008, "Unauthorized");
            this.client = null;
            return;
          }
        }

        // Validate protocol version
        if (hello.protocolVersion !== PROTOCOL_VERSION) {
          const error = createIncompatibleProtocolError(hello.protocolVersion, PROTOCOL_VERSION);
          ws.send(JSON.stringify(error));
          ws.close(1002, "Incompatible protocol version");
          this.client = null;
          return;
        }

        // Send welcome with full state — only mark handshake complete after
        // the welcome is actually sent (closes the race window).
        try {
          const welcome = await this.buildWelcomeMessage();
          ws.send(JSON.stringify(welcome));
          handshakeComplete = true;
        } catch (err) {
          const error = createError(
            "PI_PROCESS_ERROR",
            `Failed to get session state: ${err instanceof Error ? err.message : "unknown"}`
          );
          ws.send(JSON.stringify(error));
          ws.close(1011, "Failed to sync state");
          this.client = null;
          return;
        }

        // Start keepalive pings (A-9)
        this.startKeepalive(ws);

        return;
      }

      // Steady-state: validate then handle client messages
      if (!isClientMessage(parsed)) {
        this.sendErrorToClient("INTERNAL_ERROR", "Invalid message format");
        return;
      }
      this.handleClientMessage(parsed);
    });

    ws.on("pong", () => {
      // Client responded — cancel the "no pong" timeout
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
      }
    });

    ws.on("close", () => {
      if (this.client === ws) {
        this.client = null;
        // Cancel pending UI requests so pi doesn't hang
        this.uiBridge.cancelAll();
        this.stopKeepalive();
      }
    });

    ws.on("error", () => {
      // Error handling — connection will close after this
    });
  }

  // ===========================================================================
  // Client → Pi relay
  // ===========================================================================

  private handleClientMessage(message: ClientMessage): void {
    switch (message.type) {
      case "command":
        // A-4: Wrap pi send in try/catch
        try {
          this.piProcess.send(message.payload);
        } catch (err) {
          this.sendErrorToClient("PI_PROCESS_ERROR", `Pi process is not responsive: ${err instanceof Error ? err.message : err}`);
        }
        break;

      case "extension_ui_response":
        // Route to UI bridge which resolves the pending request
        this.uiBridge.handleResponse(message.id, {
          type: "extension_ui_response",
          id: message.id,
          value: message.value,
          confirmed: message.confirmed,
          cancelled: message.cancelled,
        });
        break;

      case "ping":
        this.sendToClient({ type: "pong" });
        break;
    }
  }

  // ===========================================================================
  // Pi → Client relay
  // ===========================================================================

  private handlePiMessage(message: Record<string, unknown>): void {
    // Check if this is a response to a pending command we sent
    if (message.type === "response" && typeof message.id === "string") {
      const pending = this.pendingPiCommands.get(message.id);
      if (pending) {
        this.pendingPiCommands.delete(message.id);
        clearTimeout(pending.timeoutId);
        pending.resolve(message);
        return;
      }
    }

    // Check if this is an extension UI request
    if (this.uiBridge.isExtensionUIRequest(message)) {
      if (this.uiBridge.isFireAndForget(message)) {
        // Fire-and-forget: just forward to client
        this.sendToClient({
          type: "extension_ui_request",
          seq: this.nextSeq(),
          ...message,
        } as ServerExtensionUIRequest);
      } else {
        // Dialog: register with UI bridge, forward to client, await response
        const id = message.id as string;

        this.uiBridge.registerRequest(id, message.method as string).then((response) => {
          // A-4: Wrap pi send in try/catch
          try {
            this.piProcess.send(response);
          } catch (err) {
            // Pi died while waiting for UI response — nothing to do, A-3 handles notification
            const _ignored = err;
          }
        });

        // Forward the request to the client
        if (this.client) {
          this.sendToClient({
            type: "extension_ui_request",
            seq: this.nextSeq(),
            ...message,
          } as ServerExtensionUIRequest);
        }
        // If no client: timeout will fire and send default response
      }
      return;
    }

    // Regular event/response: wrap with seq and forward
    const serverMsg: ServerEventMessage = {
      type: "event",
      seq: this.nextSeq(),
      payload: message,
    };
    this.sendToClient(serverMsg);
  }

  // ===========================================================================
  // Pi process exit (A-3)
  // ===========================================================================

  private handlePiExit(code: number | null, signal: string | null): void {
    if (this.isShuttingDown) return; // A-7: normal shutdown, don't treat as error

    const msg = `Pi process exited (code=${code}, signal=${signal})`;
    if (this.client) {
      this.sendErrorToClient("PI_PROCESS_ERROR", msg);
      this.client.close(1011, "Pi process exited");
      this.client = null;
    }
  }

  // ===========================================================================
  // State sync
  // ===========================================================================

  /**
   * Build a WelcomeMessage by querying pi for current state and messages.
   */
  private async buildWelcomeMessage(): Promise<WelcomeMessage> {
    const [stateResponse, messagesResponse] = await Promise.all([
      this.sendPiCommand({ type: "get_state" }),
      this.sendPiCommand({ type: "get_messages" }),
    ]);

    const state = (stateResponse as Record<string, unknown>).data as Record<string, unknown> ?? {};
    const messagesData = (messagesResponse as Record<string, unknown>).data as Record<string, unknown> ?? {};
    const messages = (messagesData.messages as unknown[]) ?? [];

    return {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      serverId: SERVER_ID,
      sessionState: state,
      messages,
      currentSeq: this.seq,
    };
  }

  /**
   * Send a command to pi and wait for the response.
   */
  private sendPiCommand(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = `srv_${++this.piCommandId}`;

      // A-8: store timeoutId so stop() can clear it
      const timeoutId = setTimeout(() => {
        this.pendingPiCommands.delete(id);
        reject(new Error(`Timeout waiting for pi response to ${command.type}`));
      }, 10_000);

      this.pendingPiCommands.set(id, { resolve, reject, timeoutId });

      // A-4: Wrap pi send in try/catch
      try {
        this.piProcess.send({ ...command, id });
      } catch (err) {
        clearTimeout(timeoutId);
        this.pendingPiCommands.delete(id);
        reject(err);
      }
    });
  }

  // ===========================================================================
  // Keepalive (A-9)
  // ===========================================================================

  private startKeepalive(ws: WebSocket): void {
    this.stopKeepalive(); // clear any previous

    this.keepaliveInterval = setInterval(() => {
      if (this.client !== ws) {
        this.stopKeepalive();
        return;
      }
      if (ws.readyState !== 1 /* OPEN */) {
        this.stopKeepalive();
        return;
      }

      ws.ping();

      // If no pong within 10s, close the connection
      this.pongTimeout = setTimeout(() => {
        if (this.client === ws) {
          this.client = null;
          this.uiBridge.cancelAll();
        }
        this.stopKeepalive();
        ws.terminate();
      }, 10_000);
    }, 30_000);
  }

  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private sendToClient(message: object): void {
    if (this.client && this.client.readyState === 1 /* OPEN */) {
      this.client.send(JSON.stringify(message));
    }
  }

  private sendErrorToClient(code: string, message: string): void {
    this.sendToClient({ type: "error", code, message });
  }

  private nextSeq(): number {
    return ++this.seq;
  }
}
