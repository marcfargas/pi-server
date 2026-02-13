/**
 * Pi-Server Wire Protocol — Error utilities
 */

import type { ErrorCode, ServerError } from "./types.js";

/**
 * Create a protocol error message.
 */
export function createError(code: ErrorCode, message: string, serverVersion?: number): ServerError {
  const error: ServerError = { type: "error", code, message };
  if (serverVersion !== undefined) {
    error.serverVersion = serverVersion;
  }
  return error;
}

/**
 * Create an incompatible protocol error.
 */
export function createIncompatibleProtocolError(
  clientVersion: number,
  serverVersion: number
): ServerError {
  return createError(
    "INCOMPATIBLE_PROTOCOL",
    `Server requires protocol v${serverVersion}, client sent v${clientVersion}`,
    serverVersion
  );
}
