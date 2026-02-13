/**
 * TUI Client — Main Ink Application
 *
 * Renders the full interactive terminal UI:
 * - Connection status bar
 * - Conversation history (completed messages in <Static>)
 * - Streaming assistant response (live area)
 * - Extension UI dialogs
 * - Text input bar
 */

import React, { useReducer, useCallback, useState, useEffect } from "react";
import { Box, Text, Static, useApp, useStdout, useInput } from "ink";
import TextInput from "ink-text-input";
import { Connection, type ConnectionState } from "./connection.js";
import {
  appReducer,
  initialState,
  type AppState,
  type CompletedMessage,
  type ToolExecution,
  type ExtensionUIRequest,
} from "./state.js";

// =============================================================================
// Main App
// =============================================================================

interface AppProps {
  url: string;
}

export default function App({ url }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [inputValue, setInputValue] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);

  // Terminal dimensions for layout
  const columns = stdout?.columns ?? 80;

  // Create and wire up connection
  useEffect(() => {
    const conn = new Connection(url, {
      onStateChange: (connState: ConnectionState) => {
        dispatch({ type: "SET_CONNECTION_STATE", state: connState });
      },

      onWelcome: (welcome) => {
        // Extract model name from session state
        const sessionState = welcome.sessionState as Record<string, unknown>;
        const model = sessionState?.model as Record<string, unknown> | undefined;
        const modelName = (model?.name as string) ?? (model?.id as string);
        dispatch({
          type: "SET_SERVER_INFO",
          protocolVersion: welcome.protocolVersion,
          serverId: welcome.serverId,
          model: modelName,
        });
        dispatch({ type: "LOAD_HISTORY", messages: welcome.messages });
      },

      onEvent: (payload) => {
        handlePiEvent(payload, dispatch);
      },

      onExtensionUI: (request) => {
        handleExtensionUI(request, dispatch, conn);
      },

      onError: (error) => {
        dispatch({
          type: "SET_ERROR",
          message: `[${error.code}] ${error.message}`,
        });
      },
    });

    conn.connect();
    setConnection(conn);

    return () => {
      conn.disconnect();
    };
  }, [url]);

  // Handle text input submission
  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Commands
      if (trimmed === "/quit" || trimmed === "/exit") {
        connection?.disconnect();
        exit();
        return;
      }

      if (trimmed === "/abort") {
        connection?.sendCommand({ type: "abort" });
        setInputValue("");
        return;
      }

      // If agent is busy, send as steer (interrupt); otherwise prompt
      if (state.isAgentBusy) {
        dispatch({ type: "USER_MESSAGE", content: `[steer] ${trimmed}` });
        connection?.sendCommand({ type: "prompt", message: trimmed, streamingBehavior: "steer" });
      } else {
        dispatch({ type: "USER_MESSAGE", content: trimmed });
        connection?.sendCommand({ type: "prompt", message: trimmed });
      }
      setInputValue("");
    },
    [connection, exit, state.isAgentBusy],
  );

  // Handle extension UI responses
  const handleExtensionUIResponse = useCallback(
    (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      if (state.extensionUI && connection) {
        connection.sendExtensionUIResponse(state.extensionUI.id, response);
        dispatch({ type: "EXTENSION_UI_DISMISS" });
      }
    },
    [state.extensionUI, connection],
  );

  // Allow typing during streaming (for steer/interrupt) — only block for ext UI
  const canInput = state.connectionState === "connected" && !state.extensionUI;

  return (
    <Box flexDirection="column" width={columns}>
      {/* Completed messages — pinned above, scroll naturally */}
      <Static items={state.completedMessages}>
        {(msg) => <MessageView key={msg.id} message={msg} width={columns} />}
      </Static>

      {/* Live area: status + streaming + input */}
      <Box flexDirection="column">
        {/* Connection status */}
        <StatusBar state={state} />

        {/* Error banner */}
        {state.errorMessage && (
          <Box marginLeft={1}>
            <Text color="red">⚠ {state.errorMessage}</Text>
          </Box>
        )}

        {/* Streaming assistant response */}
        {state.isAgentBusy && (
          <StreamingArea
            text={state.streamingText}
            tools={state.streamingTools}
          />
        )}

        {/* Extension UI dialog */}
        {state.extensionUI && (
          <ExtensionUIDialog
            request={state.extensionUI}
            onRespond={handleExtensionUIResponse}
          />
        )}

        {/* Input bar */}
        <Box>
          <Box>
            <Text color={canInput ? "green" : "gray"}>
              {state.isAgentBusy ? "⏳" : "❯"}{" "}
            </Text>
            {canInput ? (
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleSubmit}
                placeholder={state.isAgentBusy ? "Type to interrupt..." : "Type a message..."}
                showCursor
              />
            ) : state.connectionState !== "connected" ? (
              <Text dimColor>Connecting...</Text>
            ) : (
              <Text dimColor>Extension dialog active</Text>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

// =============================================================================
// Status Bar
// =============================================================================

function StatusBar({ state }: { state: AppState }) {
  const stateColor: Record<ConnectionState, string> = {
    disconnected: "red",
    connecting: "yellow",
    handshaking: "yellow",
    connected: "green",
  };

  const stateLabel: Record<ConnectionState, string> = {
    disconnected: "● Disconnected",
    connecting: "◌ Connecting...",
    handshaking: "◌ Handshaking...",
    connected: "● Connected",
  };

  return (
    <Box marginBottom={0} gap={2}>
      <Text color={stateColor[state.connectionState]}>
        {stateLabel[state.connectionState]}
      </Text>
      {state.serverInfo && (
        <Text dimColor>
          {state.serverInfo.serverId} · v{state.serverInfo.protocolVersion}
          {state.serverInfo.model ? ` · ${state.serverInfo.model}` : ""}
        </Text>
      )}
    </Box>
  );
}

// =============================================================================
// Message View (for completed messages in <Static>)
// =============================================================================

function MessageView({
  message,
  width: _width,
}: {
  message: CompletedMessage;
  width: number;
}) {
  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="blue">
          You
        </Text>
        <Box marginLeft={2}>
          <Text>{message.content}</Text>
        </Box>
      </Box>
    );
  }

  // Assistant message
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">
        Assistant
      </Text>
      {message.tools?.map((tool, i) => (
        <Box key={i} marginLeft={2}>
          <Text dimColor>
            → {tool.name}({tool.args})
          </Text>
        </Box>
      ))}
      {message.content && (
        <Box marginLeft={2}>
          <Text>{message.content}</Text>
        </Box>
      )}
    </Box>
  );
}

// =============================================================================
// Streaming Area (live assistant response)
// =============================================================================

function StreamingArea({
  text,
  tools,
}: {
  text: string;
  tools: ToolExecution[];
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">
        Assistant
      </Text>
      {tools.map((tool, i) => (
        <Box key={i} marginLeft={2}>
          <Text dimColor>
            → {tool.name}({tool.args})
          </Text>
        </Box>
      ))}
      {text ? (
        <Box marginLeft={2}>
          <Text>{text}</Text>
        </Box>
      ) : (
        <Box marginLeft={2}>
          <Text dimColor>Thinking...</Text>
        </Box>
      )}
    </Box>
  );
}

// =============================================================================
// Extension UI Dialog
// =============================================================================

function ExtensionUIDialog({
  request,
  onRespond,
}: {
  request: ExtensionUIRequest;
  onRespond: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
}) {
  const [inputValue, setInputValue] = useState(request.defaultValue ?? "");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Select dialog
  if (request.method === "select" && request.options) {
    return (
      <ExtensionUISelect
        request={request}
        options={request.options}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        onRespond={onRespond}
      />
    );
  }

  // Confirm dialog
  if (request.method === "confirm") {
    return (
      <ExtensionUIConfirm request={request} onRespond={onRespond} />
    );
  }

  // Input dialog
  if (request.method === "input" || request.method === "editor") {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
      >
        <Text bold color="cyan">
          {request.title ?? "Input"}
        </Text>
        {request.message && <Text>{request.message}</Text>}
        <Box marginTop={1}>
          <Text color="cyan">❯ </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={(val) => onRespond({ value: val })}
            showCursor
          />
        </Box>
        <Text dimColor>Enter to submit · Esc to cancel</Text>
      </Box>
    );
  }

  // Fallback
  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>
        Extension UI: {request.method} "{request.title}" — not implemented
      </Text>
    </Box>
  );
}

// Select sub-component
function ExtensionUISelect({
  request,
  options,
  selectedIndex,
  onSelect,
  onRespond,
}: {
  request: ExtensionUIRequest;
  options: Array<{ label: string; value: string }>;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onRespond: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
}) {
  useInput((input, key) => {
    if (key.upArrow) {
      onSelect(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      onSelect(Math.min(options.length - 1, selectedIndex + 1));
    } else if (key.return) {
      onRespond({ value: options[selectedIndex]!.value });
    } else if (key.escape) {
      onRespond({ cancelled: true });
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold color="cyan">
        {request.title ?? "Select"}
      </Text>
      {request.message && <Text>{request.message}</Text>}
      {options.map((opt, i) => (
        <Text key={opt.value} color={i === selectedIndex ? "cyan" : undefined}>
          {i === selectedIndex ? "❯" : " "} {opt.label}
        </Text>
      ))}
      <Text dimColor>↑↓ to navigate · Enter to select · Esc to cancel</Text>
    </Box>
  );
}

// Confirm sub-component
function ExtensionUIConfirm({
  request,
  onRespond,
}: {
  request: ExtensionUIRequest;
  onRespond: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
}) {
  useInput((input, key) => {
    if (input === "y" || input === "Y") {
      onRespond({ confirmed: true });
    } else if (input === "n" || input === "N" || key.escape) {
      onRespond({ confirmed: false });
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold color="cyan">
        {request.title ?? "Confirm"}
      </Text>
      {request.message && <Text>{request.message}</Text>}
      <Text dimColor>y/n to confirm · Esc to cancel</Text>
    </Box>
  );
}

// =============================================================================
// Event Handlers
// =============================================================================

function handlePiEvent(
  payload: Record<string, unknown>,
  dispatch: React.Dispatch<import("./state.js").AppAction>,
): void {
  const type = payload.type as string;

  switch (type) {
    case "agent_start":
      dispatch({ type: "AGENT_START" });
      break;

    case "agent_end":
      dispatch({ type: "AGENT_END" });
      break;

    case "message_update": {
      const evt = payload.assistantMessageEvent as
        | Record<string, unknown>
        | undefined;
      if (evt?.type === "text_delta" && typeof evt.delta === "string") {
        dispatch({ type: "TEXT_DELTA", delta: evt.delta });
      }
      break;
    }

    case "tool_execution_start": {
      const name = (payload.toolName as string) ?? "unknown";
      const args = payload.args
        ? JSON.stringify(payload.args).slice(0, 120)
        : "";
      dispatch({ type: "TOOL_START", name, args });
      break;
    }

    case "tool_execution_end": {
      const isError = payload.isError as boolean;
      if (isError) {
        dispatch({
          type: "SET_ERROR",
          message: `Tool ${payload.toolName} failed`,
        });
      }
      break;
    }

    case "auto_retry_start": {
      const attempt = payload.attempt as number;
      const max = payload.maxAttempts as number;
      const errMsg = payload.errorMessage as string;
      dispatch({
        type: "SET_ERROR",
        message: `Retrying (${attempt}/${max}): ${errMsg}`,
      });
      break;
    }

    case "auto_retry_end": {
      const success = payload.success as boolean;
      if (success) {
        dispatch({ type: "CLEAR_ERROR" });
      } else {
        dispatch({
          type: "SET_ERROR",
          message: `Retry failed after ${payload.attempt} attempts: ${payload.finalError}`,
        });
      }
      break;
    }

    case "response": {
      const success = (payload as Record<string, unknown>).success;
      if (success === false) {
        const error =
          ((payload as Record<string, unknown>).error as string) ??
          "Unknown error";
        dispatch({ type: "SET_ERROR", message: error });
      }
      break;
    }
  }
}

function handleExtensionUI(
  request: Record<string, unknown>,
  dispatch: React.Dispatch<import("./state.js").AppAction>,
  connection: Connection,
): void {
  const method = request.method as string;
  const id = request.id as string;

  // Fire-and-forget methods — just display info
  if (method === "notify") {
    // Could show a toast, for now dispatch as system message
    dispatch({
      type: "SET_ERROR",
      message: `ℹ ${request.message as string}`,
    });
    return;
  }
  if (method === "setStatus") {
    // Status updates could go to the status bar
    return;
  }

  // Dialog methods — show UI
  if (
    method === "select" ||
    method === "confirm" ||
    method === "input" ||
    method === "editor"
  ) {
    dispatch({
      type: "EXTENSION_UI_REQUEST",
      request: {
        id,
        method: method as ExtensionUIRequest["method"],
        title: request.title as string | undefined,
        message: request.message as string | undefined,
        options: request.options as
          | Array<{ label: string; value: string }>
          | undefined,
        defaultValue: request.defaultValue as string | undefined,
      },
    });
  }
}
