/**
 * Pi-Server Wire Protocol — Types
 *
 * Defines the messages exchanged between pi-server and its clients over WebSocket.
 *
 * The server relays pi's RPC protocol (JSON lines on stdin/stdout) over WebSocket.
 * These types define the framing AROUND pi's messages, not the messages themselves.
 * Pi's RPC types (RpcCommand, AgentSessionEvent, etc.) are treated as opaque JSON
 * payloads — the server does not parse or validate them.
 *
 * Protocol version: see version.ts
 */

// =============================================================================
// Connection Handshake
// =============================================================================

/**
 * Client → Server: First message after WebSocket connect.
 * Server validates protocolVersion and responds with WelcomeMessage or ErrorMessage.
 */
export interface HelloMessage {
  type: "hello";
  /** Must match server's PROTOCOL_VERSION */
  protocolVersion: number;
  /** Unique client identifier (UUID). Stable across reconnects for the same client. */
  clientId: string;
  /** Reserved for future reconnect: last sequence number received. */
  lastSeq?: number;
  /** Reserved for future auth. Server ignores in protocol v1. */
  auth?: {
    type: string;
    token: string;
  };
}

/**
 * Server → Client: Response to a valid HelloMessage.
 * Contains full session state for the client to render from scratch.
 */
export interface WelcomeMessage {
  type: "welcome";
  /** Server's protocol version (must match client's) */
  protocolVersion: number;
  /** Stable server identifier (persists across restarts) */
  serverId: string;
  /** Current pi session state (from pi's `get_state` RPC command) */
  sessionState: Record<string, unknown>;
  /** Conversation history (from pi's `get_messages` RPC command) */
  messages: unknown[];
  /** Current sequence number — client will receive events starting from seq+1 */
  currentSeq: number;
}

// =============================================================================
// Steady-State: Client → Server
// =============================================================================

/**
 * Client → Server: Any pi RPC command or extension UI response.
 * The server relays these to pi's stdin as JSON lines.
 */
export interface ClientCommandMessage {
  type: "command";
  /** The pi RPC command payload (prompt, steer, abort, get_state, etc.) */
  payload: Record<string, unknown>;
}

/**
 * Client → Server: Response to an extension UI dialog request.
 */
export interface ClientExtensionUIResponse {
  type: "extension_ui_response";
  /** Matches the id from the extension_ui_request */
  id: string;
  /** Response value — structure depends on the dialog method */
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

/**
 * Client → Server: Keepalive ping.
 */
export interface ClientPing {
  type: "ping";
}

/** Union of all client → server messages (after hello) */
export type ClientMessage =
  | ClientCommandMessage
  | ClientExtensionUIResponse
  | ClientPing;

// =============================================================================
// Steady-State: Server → Client
// =============================================================================

/**
 * Server → Client: Wraps a pi event or response with a sequence number.
 * The payload is relayed from pi's stdout as-is (opaque JSON).
 */
export interface ServerEventMessage {
  type: "event";
  /** Monotonically increasing sequence number */
  seq: number;
  /** The pi event or RPC response payload (relayed as-is from pi's stdout) */
  payload: Record<string, unknown>;
}

/**
 * Server → Client: Extension UI request from pi.
 * The client must render the appropriate UI widget and respond.
 * If no response within timeout, server sends default response to pi.
 */
export interface ServerExtensionUIRequest {
  type: "extension_ui_request";
  /** Sequence number */
  seq: number;
  /** Request ID (must be echoed in response) */
  id: string;
  /** Dialog method: select, confirm, input, editor, notify, setStatus, setWidget, setTitle, set_editor_text */
  method: string;
  /** Method-specific parameters (title, options, message, etc.) */
  [key: string]: unknown;
}

/**
 * Server → Client: Keepalive pong.
 */
export interface ServerPong {
  type: "pong";
}

/**
 * Server → Client: Error (protocol error, not pi agent error).
 */
export interface ServerError {
  type: "error";
  /** Machine-readable error code */
  code: ErrorCode;
  /** Human-readable message */
  message: string;
  /** Server's protocol version (included in version mismatch errors) */
  serverVersion?: number;
}

/** Union of all server → client messages (after welcome) */
export type ServerMessage =
  | ServerEventMessage
  | ServerExtensionUIRequest
  | ServerPong
  | ServerError;

// =============================================================================
// Error Codes
// =============================================================================

export type ErrorCode =
  | "INCOMPATIBLE_PROTOCOL"   // protocolVersion mismatch
  | "INVALID_HELLO"           // malformed hello message
  | "SESSION_NOT_FOUND"       // pi process not running
  | "PI_PROCESS_ERROR"        // pi child process crashed
  | "EXTENSION_UI_TIMEOUT"    // no response to UI request within timeout
  | "INTERNAL_ERROR";         // unexpected server error

// =============================================================================
// Configuration
// =============================================================================

/** Server configuration (subset exposed to protocol for documentation) */
export interface ServerConfig {
  /** WebSocket port */
  port: number;
  /** Working directory for the pi process */
  cwd: string;
  /** Path to pi CLI (default: auto-detected from PATH) */
  piCliPath?: string;
  /** Additional arguments to pass to pi */
  piArgs?: string[];
  /** Extension UI dialog timeout in milliseconds (default: 60000) */
  extensionUITimeoutMs?: number;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Type guard: is this a HelloMessage?
 */
export function isHelloMessage(msg: unknown): msg is HelloMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).type === "hello"
  );
}

/**
 * Type guard: is this a ClientMessage (post-handshake)?
 */
export function isClientMessage(msg: unknown): msg is ClientMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const type = (msg as Record<string, unknown>).type;
  return type === "command" || type === "extension_ui_response" || type === "ping";
}
