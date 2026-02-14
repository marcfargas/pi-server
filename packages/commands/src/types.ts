/**
 * Command and completion types — UI-technology agnostic.
 *
 * These types describe commands, their argument schemas, and completion data
 * so any client (TUI, web, etc.) can build its own UI.
 */

// =============================================================================
// Argument Schemas — describe what a command accepts for completion
// =============================================================================

/** Command takes no arguments */
export interface ArgNone {
  type: "none";
}

/** Command takes free-form text */
export interface ArgFreeText {
  type: "free_text";
  required: boolean;
  placeholder?: string;
}

/** Command takes one of a fixed set of values */
export interface ArgEnum {
  type: "enum";
  values: string[];
  required: boolean;
}

/** Command takes a model selector (provider/modelId) — completable from model list */
export interface ArgModelSelector {
  type: "model_selector";
  required: boolean;
}

/** Command opens a picker (e.g., fork message selection) */
export interface ArgPicker {
  type: "picker";
  /** Hint for what the picker shows — client fetches data as needed */
  pickerType: string;
  required: boolean;
}

export type ArgSchema = ArgNone | ArgFreeText | ArgEnum | ArgModelSelector | ArgPicker;

// =============================================================================
// Unified Command — one type for both builtin and extension commands
// =============================================================================

export interface UnifiedCommand {
  /** Slash command name (without the /) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Where this command comes from */
  source: "builtin" | "extension" | "skill" | "prompt";
  /** Argument schema for completion — missing means no completion data available */
  args?: ArgSchema;
}

// =============================================================================
// RPC Command payload — what gets sent to pi
// =============================================================================

/** A typed RPC command ready to send to pi */
export interface RpcPayload {
  type: string;
  [key: string]: unknown;
}
