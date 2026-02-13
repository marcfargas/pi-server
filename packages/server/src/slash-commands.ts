/**
 * Slash Command Router
 *
 * Maps pi TUI slash commands to RPC commands.
 * Pi's `prompt` RPC handles extension commands and skills, but NOT built-in
 * TUI commands like /model, /compact, /thinking. Those need explicit RPC calls.
 *
 * The server owns this mapping so the client stays dumb — it just sends text.
 * The mapping is defined as data, not code, so it's easy to update.
 */

export interface SlashMapping {
  /** RPC command type */
  rpcType: string;
  /** Does this command take an argument? */
  hasArg?: boolean;
  /** Name of the arg field in the RPC command */
  argField?: string;
  /** RPC type to use when no argument is given (e.g., cycle_model vs set_model) */
  noArgRpcType?: string;
  /** Description for command discovery */
  description: string;
}

/**
 * Built-in pi TUI commands that need RPC mapping.
 * These are NOT returned by pi's get_commands (which only covers extensions/skills/templates).
 */
const BUILTIN_COMMANDS: Record<string, SlashMapping> = {
  model: {
    rpcType: "set_model",
    noArgRpcType: "cycle_model",
    hasArg: true,
    argField: "modelId",
    description: "Switch model (no arg = cycle, or provider/modelId)",
  },
  thinking: {
    rpcType: "set_thinking_level",
    noArgRpcType: "cycle_thinking_level",
    hasArg: true,
    argField: "level",
    description: "Set thinking level (no arg = cycle)",
  },
  compact: {
    rpcType: "compact",
    hasArg: true,
    argField: "customInstructions",
    description: "Compact conversation context",
  },
  new: {
    rpcType: "new_session",
    description: "Start a new session",
  },
  abort: {
    rpcType: "abort",
    description: "Abort current agent run",
  },
  stats: {
    rpcType: "get_session_stats",
    description: "Show token usage and cost",
  },
  name: {
    rpcType: "set_session_name",
    hasArg: true,
    argField: "name",
    description: "Set session name",
  },
  retry: {
    rpcType: "abort_retry",
    description: "Abort current retry",
  },
};

/**
 * Try to route a prompt message as a slash command.
 * Returns the RPC command if matched, null if it should go through as prompt.
 */
export function routeSlashCommand(message: string): Record<string, unknown> | null {
  if (!message.startsWith("/")) return null;

  const spaceIdx = message.indexOf(" ");
  const name = spaceIdx > 0 ? message.slice(1, spaceIdx) : message.slice(1);
  const arg = spaceIdx > 0 ? message.slice(spaceIdx + 1).trim() : undefined;

  const mapping = BUILTIN_COMMANDS[name];
  if (!mapping) return null; // Not a built-in → let prompt handle it (extension/skill)

  if (!arg && mapping.noArgRpcType) {
    return { type: mapping.noArgRpcType };
  }

  const rpc: Record<string, unknown> = { type: mapping.rpcType };
  if (arg && mapping.argField) {
    // Special case: /model provider/modelId
    if (name === "model" && arg.includes("/")) {
      const slashIdx = arg.indexOf("/");
      rpc.provider = arg.slice(0, slashIdx);
      rpc.modelId = arg.slice(slashIdx + 1);
    } else {
      rpc[mapping.argField] = arg;
    }
  }
  return rpc;
}

/**
 * Get the built-in command list for discovery.
 * Merge with pi's get_commands response to give the client a complete picture.
 */
export function getBuiltinCommands(): Array<{ name: string; description: string; source: string }> {
  return Object.entries(BUILTIN_COMMANDS).map(([name, mapping]) => ({
    name,
    description: mapping.description,
    source: "builtin",
  }));
}
