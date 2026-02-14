/**
 * Command Discovery
 *
 * Merges pi's get_commands (extensions/skills/templates) with the builtin catalog
 * to produce a unified command list for client UIs.
 */

import { getBuiltinCommands } from "./catalog.js";
import type { UnifiedCommand } from "./types.js";

/** Raw command entry from pi's get_commands response */
export interface PiCommand {
  name: string;
  description?: string;
  source: string;
  location?: string;
  path?: string;
}

/**
 * Merge pi's discovered commands with the builtin catalog.
 *
 * @param piCommands - Commands from pi's get_commands RPC response
 * @returns Unified command list (builtins first, then extensions/skills/templates)
 */
export function mergeCommands(piCommands: PiCommand[]): UnifiedCommand[] {
  const builtins = getBuiltinCommands();

  const discovered: UnifiedCommand[] = piCommands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description ?? "",
    source: cmd.source as UnifiedCommand["source"],
  }));

  return [...builtins, ...discovered];
}

/**
 * Extract command names from pi's get_commands for the router.
 * Returns a Set for O(1) lookup.
 */
export function extractCommandNames(piCommands: PiCommand[]): Set<string> {
  return new Set(piCommands.map((cmd) => cmd.name));
}
