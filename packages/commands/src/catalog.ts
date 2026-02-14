/**
 * Builtin Command Catalog
 *
 * Pi's RPC protocol has typed commands (cycle_model, compact, etc.) that are
 * NOT discoverable via get_commands and NOT dispatchable via prompt.
 * This catalog defines them as data so clients can route and complete them.
 *
 * This is the ONE place where builtin commands are defined.
 * When pi adds new RPC commands, update this file.
 */

import type { UnifiedCommand, ArgSchema } from "./types.js";

export interface BuiltinDef {
  /** Slash command name (without /) */
  name: string;
  description: string;
  args: ArgSchema;
  /**
   * Map user input to RPC payload.
   * - `arg` is the text after the command name (trimmed), or undefined if no arg.
   * - Returns the RPC payload to send to pi.
   */
  toRpc(arg?: string): { type: string; [key: string]: unknown };
}

/**
 * All builtin commands. Ordered by frequency of use.
 */
export const BUILTIN_COMMANDS: readonly BuiltinDef[] = [
  {
    name: "model",
    description: "Switch model (no arg = cycle to next)",
    args: { type: "model_selector", required: false },
    toRpc(arg) {
      if (!arg) return { type: "cycle_model" };
      const slash = arg.indexOf("/");
      if (slash > 0) {
        return { type: "set_model", provider: arg.slice(0, slash), modelId: arg.slice(slash + 1) };
      }
      return { type: "set_model", modelId: arg };
    },
  },
  {
    name: "thinking",
    description: "Set thinking level (no arg = cycle)",
    args: { type: "enum", values: ["off", "minimal", "low", "medium", "high", "xhigh"], required: false },
    toRpc(arg) {
      if (!arg) return { type: "cycle_thinking_level" };
      return { type: "set_thinking_level", level: arg };
    },
  },
  {
    name: "compact",
    description: "Compact conversation context",
    args: { type: "free_text", required: false, placeholder: "Custom instructions" },
    toRpc(arg) {
      if (!arg) return { type: "compact" };
      return { type: "compact", customInstructions: arg };
    },
  },
  {
    name: "abort",
    description: "Abort current agent run",
    args: { type: "none" },
    toRpc() {
      return { type: "abort" };
    },
  },
  {
    name: "new",
    description: "Start a new session",
    args: { type: "none" },
    toRpc() {
      return { type: "new_session" };
    },
  },
  {
    name: "stats",
    description: "Show token usage and cost",
    args: { type: "none" },
    toRpc() {
      return { type: "get_session_stats" };
    },
  },
  {
    name: "name",
    description: "Set session name",
    args: { type: "free_text", required: true, placeholder: "Session name" },
    toRpc(arg) {
      return { type: "set_session_name", name: arg ?? "" };
    },
  },
  {
    name: "fork",
    description: "Fork from a previous message",
    args: { type: "picker", pickerType: "fork_messages", required: false },
    toRpc(arg) {
      if (!arg) return { type: "get_fork_messages" };
      return { type: "fork", entryId: arg };
    },
  },
  {
    name: "export",
    description: "Export session to HTML",
    args: { type: "free_text", required: false, placeholder: "Output path" },
    toRpc(arg) {
      if (!arg) return { type: "export_html" };
      return { type: "export_html", outputPath: arg };
    },
  },
] as const;

/** Lookup map for O(1) access */
const builtinsByName = new Map<string, BuiltinDef>(
  BUILTIN_COMMANDS.map((cmd) => [cmd.name, cmd]),
);

/** Get a builtin command by name, or undefined if not a builtin */
export function getBuiltin(name: string): BuiltinDef | undefined {
  return builtinsByName.get(name);
}

/** Get all builtin commands as UnifiedCommand entries */
export function getBuiltinCommands(): UnifiedCommand[] {
  return BUILTIN_COMMANDS.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    source: "builtin" as const,
    args: cmd.args,
  }));
}
