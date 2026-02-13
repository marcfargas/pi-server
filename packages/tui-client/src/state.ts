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
  name: string;
  args: string;
}

export interface CompletedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
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
  /** Tool calls during current assistant turn */
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
  | { type: "TOOL_START"; name: string; args: string }
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
        streamingTools: [],
      };

    case "AGENT_END": {
      // Commit streaming text + tools as a completed assistant message
      const completed: CompletedMessage[] = [...state.completedMessages];
      if (state.streamingText || state.streamingTools.length > 0) {
        completed.push({
          id: `msg-${++messageCounter}`,
          role: "assistant",
          content: state.streamingText,
          tools: state.streamingTools.length > 0 ? state.streamingTools : undefined,
        });
      }
      return {
        ...state,
        isAgentBusy: false,
        streamingText: "",
        streamingTools: [],
        completedMessages: completed,
      };
    }

    case "TEXT_DELTA":
      return { ...state, streamingText: state.streamingText + action.delta };

    case "TOOL_START":
      return {
        ...state,
        streamingTools: [
          ...state.streamingTools,
          { name: action.name, args: action.args },
        ],
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
// History Parsing
// =============================================================================

/**
 * Parse pi's message history into our display format.
 * Pi messages follow Anthropic's format:
 *   { role: "user"|"assistant", content: string | ContentBlock[] }
 */
function parseHistoryMessages(raw: unknown[]): CompletedMessage[] {
  const messages: CompletedMessage[] = [];

  for (const msg of raw) {
    const m = msg as Record<string, unknown>;
    const role = m.role as string;

    if (role === "user" || role === "assistant") {
      let content = "";
      const tools: ToolExecution[] = [];

      if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        for (const block of m.content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text") {
            content += b.text as string;
          } else if (b.type === "tool_use") {
            tools.push({
              name: b.name as string,
              args: JSON.stringify(b.input).slice(0, 120),
            });
          } else if (b.type === "tool_result") {
            // Tool results are usually in user messages, skip for display
          }
        }
      }

      if (content || tools.length > 0) {
        messages.push({
          id: `hist-${++messageCounter}`,
          role: role as "user" | "assistant",
          content,
          tools: tools.length > 0 ? tools : undefined,
        });
      }
    }
  }

  return messages;
}
