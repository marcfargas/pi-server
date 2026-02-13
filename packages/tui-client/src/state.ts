/**
 * TUI Client State — Types and Reducer
 *
 * All application state flows through a single reducer.
 * The Connection callbacks dispatch actions to update state.
 */

import type { ConnectionState } from "./connection.js";

// =============================================================================
// Message Types
// =============================================================================

export interface ToolExecution {
  id: string;
  name: string;
  args: string;
  /** Streaming partial output (replaced on each update) */
  output?: string;
  /** Final result (set on tool_execution_end) */
  result?: string;
  isError?: boolean;
  done?: boolean;
}

export interface CompletedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  tools?: ToolExecution[];
}

export interface ExtensionUIRequest {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title?: string;
  message?: string;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: string;
}

// =============================================================================
// App State
// =============================================================================

export interface AppState {
  connectionState: ConnectionState;
  serverInfo: { protocolVersion: number; serverId: string; model?: string } | null;

  /** Completed conversation turns (rendered in <Static>) */
  completedMessages: CompletedMessage[];

  /** Currently streaming assistant text */
  streamingText: string;
  /** Currently streaming thinking text */
  streamingThinking: string;
  /** Tool calls during current assistant turn (keyed by toolCallId) */
  streamingTools: ToolExecution[];

  /** Whether the agent is processing */
  isAgentBusy: boolean;

  /** Active extension UI dialog (null if none) */
  extensionUI: ExtensionUIRequest | null;

  /** Error message to display (transient) */
  errorMessage: string | null;
}

export const initialState: AppState = {
  connectionState: "disconnected",
  serverInfo: null,
  completedMessages: [],
  streamingText: "",
  streamingThinking: "",
  streamingTools: [],
  isAgentBusy: false,
  extensionUI: null,
  errorMessage: null,
};

// =============================================================================
// Actions
// =============================================================================

export type AppAction =
  | { type: "SET_CONNECTION_STATE"; state: ConnectionState }
  | { type: "SET_SERVER_INFO"; protocolVersion: number; serverId: string; model?: string }
  | { type: "LOAD_HISTORY"; messages: unknown[] }
  | { type: "USER_MESSAGE"; content: string }
  | { type: "AGENT_START" }
  | { type: "AGENT_END" }
  | { type: "TEXT_DELTA"; delta: string }
  | { type: "THINKING_DELTA"; delta: string }
  | { type: "TOOL_START"; id: string; name: string; args: string }
  | { type: "TOOL_UPDATE"; id: string; output: string }
  | { type: "TOOL_END"; id: string; result: string; isError: boolean }
  | { type: "EXTENSION_UI_REQUEST"; request: ExtensionUIRequest }
  | { type: "EXTENSION_UI_DISMISS" }
  | { type: "SET_ERROR"; message: string }
  | { type: "CLEAR_ERROR" };

// =============================================================================
// Reducer
// =============================================================================

let messageCounter = 0;

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_CONNECTION_STATE":
      return { ...state, connectionState: action.state };

    case "SET_SERVER_INFO":
      return {
        ...state,
        serverInfo: {
          protocolVersion: action.protocolVersion,
          serverId: action.serverId,
          model: action.model,
        },
      };

    case "LOAD_HISTORY": {
      const messages = parseHistoryMessages(action.messages);
      return { ...state, completedMessages: messages };
    }

    case "USER_MESSAGE":
      return {
        ...state,
        completedMessages: [
          ...state.completedMessages,
          {
            id: `msg-${++messageCounter}`,
            role: "user",
            content: action.content,
          },
        ],
      };

    case "AGENT_START":
      return {
        ...state,
        isAgentBusy: true,
        streamingText: "",
        streamingThinking: "",
        streamingTools: [],
      };

    case "AGENT_END": {
      const completed: CompletedMessage[] = [...state.completedMessages];
      if (state.streamingText || state.streamingThinking || state.streamingTools.length > 0) {
        completed.push({
          id: `msg-${++messageCounter}`,
          role: "assistant",
          content: state.streamingText,
          thinking: state.streamingThinking || undefined,
          tools: state.streamingTools.length > 0 ? state.streamingTools : undefined,
        });
      }
      return {
        ...state,
        isAgentBusy: false,
        streamingText: "",
        streamingThinking: "",
        streamingTools: [],
        completedMessages: completed,
      };
    }

    case "TEXT_DELTA":
      return { ...state, streamingText: state.streamingText + action.delta };

    case "THINKING_DELTA":
      return { ...state, streamingThinking: state.streamingThinking + action.delta };

    case "TOOL_START":
      return {
        ...state,
        streamingTools: [
          ...state.streamingTools,
          { id: action.id, name: action.name, args: action.args },
        ],
      };

    case "TOOL_UPDATE":
      return {
        ...state,
        streamingTools: state.streamingTools.map((t) =>
          t.id === action.id ? { ...t, output: action.output } : t,
        ),
      };

    case "TOOL_END":
      return {
        ...state,
        streamingTools: state.streamingTools.map((t) =>
          t.id === action.id
            ? { ...t, result: action.result, isError: action.isError, done: true }
            : t,
        ),
      };

    case "EXTENSION_UI_REQUEST":
      return { ...state, extensionUI: action.request };

    case "EXTENSION_UI_DISMISS":
      return { ...state, extensionUI: null };

    case "SET_ERROR":
      return { ...state, errorMessage: action.message };

    case "CLEAR_ERROR":
      return { ...state, errorMessage: null };

    default:
      return state;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Extract text from tool result content blocks */
export function extractToolText(content: unknown): string {
  if (!Array.isArray(content)) return String(content ?? "");
  return (content as Array<Record<string, unknown>>)
    .filter((b) => b.type === "text")
    .map((b) => b.text as string)
    .join("\n");
}

// =============================================================================
// History Parsing
// =============================================================================

/**
 * Parse pi's message history into our display format.
 */
function parseHistoryMessages(raw: unknown[]): CompletedMessage[] {
  const messages: CompletedMessage[] = [];
  // Collect tool results from user messages to attach to previous assistant
  const toolResults = new Map<string, { content: string; isError: boolean }>();

  // First pass: collect tool results
  for (const msg of raw) {
    const m = msg as Record<string, unknown>;
    if (m.role === "toolResult") {
      const content = extractToolText(m.content);
      toolResults.set(m.toolCallId as string, {
        content,
        isError: m.isError as boolean,
      });
    }
  }

  // Second pass: build messages
  for (const msg of raw) {
    const m = msg as Record<string, unknown>;
    const role = m.role as string;

    if (role === "user") {
      let content = "";
      if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        for (const block of m.content as Array<Record<string, unknown>>) {
          if (block.type === "text") content += block.text as string;
        }
      }
      if (content) {
        messages.push({
          id: `hist-${++messageCounter}`,
          role: "user",
          content,
        });
      }
    }

    if (role === "assistant") {
      let content = "";
      let thinking = "";
      const tools: ToolExecution[] = [];

      if (Array.isArray(m.content)) {
        for (const block of m.content as Array<Record<string, unknown>>) {
          if (block.type === "text") {
            content += block.text as string;
          } else if (block.type === "thinking") {
            thinking += block.thinking as string;
          } else if (block.type === "toolCall") {
            const toolId = block.id as string;
            const result = toolResults.get(toolId);
            tools.push({
              id: toolId,
              name: block.name as string,
              args: JSON.stringify(block.arguments ?? {}).slice(0, 120),
              result: result?.content,
              isError: result?.isError,
              done: true,
            });
          }
        }
      }

      if (content || thinking || tools.length > 0) {
        messages.push({
          id: `hist-${++messageCounter}`,
          role: "assistant",
          content,
          thinking: thinking || undefined,
          tools: tools.length > 0 ? tools : undefined,
        });
      }
    }
  }

  return messages;
}
