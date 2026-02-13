/**
 * WebSocket Connection Manager
 *
 * Handles connecting to a pi-server instance, sending the hello handshake,
 * receiving the welcome state, and reconnecting on disconnect.
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import {
  PROTOCOL_VERSION,
  type HelloMessage,
  type WelcomeMessage,
  type ServerMessage,
  type ServerError,
  type ClientCommandMessage,
  type ClientExtensionUIResponse,
} from "@pi-server/protocol";

export type ConnectionState = "disconnected" | "connecting" | "handshaking" | "connected";

export interface ConnectionEvents {
  /** Called when connection state changes */
  onStateChange?: (state: ConnectionState) => void;
  /** Called when welcome message received (initial state) */
  onWelcome?: (welcome: WelcomeMessage) => void;
  /** Called for each server event message */
  onEvent?: (payload: Record<string, unknown>, seq: number) => void;
  /** Called for extension UI requests */
  onExtensionUI?: (request: Record<string, unknown>) => void;
  /** Called on protocol errors */
  onError?: (error: ServerError) => void;
}

export class Connection {
  private ws: WebSocket | null = null;
  private clientId: string;
  private url: string;
  private events: ConnectionEvents;
  private state: ConnectionState = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeq = 0;

  constructor(url: string, events: ConnectionEvents) {
    this.url = url;
    this.clientId = randomUUID();
    this.events = events;
  }

  /**
   * Connect to the server.
   */
  connect(): void {
    if (this.ws) return;

    this.setState("connecting");
    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      this.setState("handshaking");
      // Send hello
      const hello: HelloMessage = {
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        clientId: this.clientId,
        lastSeq: this.lastSeq > 0 ? this.lastSeq : undefined,
      };
      this.ws!.send(JSON.stringify(hello));
    });

    this.ws.on("message", (data) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }

      this.handleMessage(parsed);
    });

    this.ws.on("close", () => {
      this.ws = null;
      this.setState("disconnected");
      this.scheduleReconnect();
    });

    this.ws.on("error", () => {
      // Error will be followed by close
    });
  }

  /**
   * Disconnect without reconnecting.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Client disconnecting");
      this.ws = null;
    }
    this.setState("disconnected");
  }

  /**
   * Send a pi RPC command to the server.
   */
  sendCommand(payload: Record<string, unknown>): void {
    const msg: ClientCommandMessage = { type: "command", payload };
    this.send(msg);
  }

  /**
   * Send an extension UI response.
   */
  sendExtensionUIResponse(id: string, response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }): void {
    const msg: ClientExtensionUIResponse = {
      type: "extension_ui_response",
      id,
      ...response,
    };
    this.send(msg);
  }

  /** Current connection state */
  get connectionState(): ConnectionState {
    return this.state;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private handleMessage(message: Record<string, unknown>): void {
    const type = message.type as string;

    switch (type) {
      case "welcome":
        this.setState("connected");
        this.events.onWelcome?.(message as unknown as WelcomeMessage);
        break;

      case "event": {
        const seq = message.seq as number;
        if (seq > this.lastSeq) this.lastSeq = seq;
        this.events.onEvent?.(message.payload as Record<string, unknown>, seq);
        break;
      }

      case "extension_ui_request":
        this.events.onExtensionUI?.(message);
        break;

      case "pong":
        // Keepalive response — nothing to do
        break;

      case "error":
        this.events.onError?.(message as unknown as ServerError);
        break;
    }
  }

  private send(message: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.events.onStateChange?.(state);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000); // Reconnect after 2s
  }
}
