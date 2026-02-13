/**
 * @pi-server/protocol — Wire protocol for pi-server
 *
 * Defines the messages exchanged between pi-server and its clients over WebSocket.
 * All packages in the pi-server monorepo import types from here.
 */

export { PROTOCOL_VERSION } from "./version.js";

export type {
  // Handshake
  HelloMessage,
  WelcomeMessage,

  // Client → Server
  ClientMessage,
  ClientCommandMessage,
  ClientExtensionUIResponse,
  ClientPing,

  // Server → Client
  ServerMessage,
  ServerEventMessage,
  ServerExtensionUIRequest,
  ServerPong,
  ServerError,

  // Misc
  ErrorCode,
  ServerConfig,
} from "./types.js";

export { isHelloMessage, isClientMessage } from "./types.js";

export {
  createError,
  createIncompatibleProtocolError,
} from "./errors.js";
