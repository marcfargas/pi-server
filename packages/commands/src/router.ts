/**
 * Command Router
 *
 * Pure function: takes user input + discovered commands → produces an RPC payload.
 * No I/O, no state, no connection logic. Clients call this and send the result.
 */

import { getBuiltin } from "./catalog.js";
import type { RpcPayload } from "./types.js";

export type RouteResult =
  | { kind: "builtin"; rpc: RpcPayload }
  | { kind: "prompt"; message: string }
  | { kind: "text"; message: string };

/**
 * Route user input to the correct RPC payload.
 *
 * @param input - Raw user input (trimmed)
 * @param discoveredCommands - Command names from pi's get_commands (extensions/skills/templates)
 * @returns What to send to pi and how
 */
export function routeInput(input: string, discoveredCommands: Set<string>): RouteResult {
  // Not a slash command → plain text prompt
  if (!input.startsWith("/")) {
    return { kind: "text", message: input };
  }

  // Parse: /name arg1 arg2...
  const spaceIdx = input.indexOf(" ");
  const name = spaceIdx > 0 ? input.slice(1, spaceIdx) : input.slice(1);
  const arg = spaceIdx > 0 ? input.slice(spaceIdx + 1).trim() : undefined;

  // Check builtin first
  const builtin = getBuiltin(name);
  if (builtin) {
    return { kind: "builtin", rpc: builtin.toRpc(arg) };
  }

  // Check discovered commands (extensions, skills, templates)
  // Skills use "skill:name" format, templates use the name directly
  if (discoveredCommands.has(name)) {
    return { kind: "prompt", message: input };
  }

  // Unknown slash command — send as prompt and let pi decide
  // (could be a new extension we haven't discovered yet)
  return { kind: "prompt", message: input };
}
