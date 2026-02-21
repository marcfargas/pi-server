/**
 * TUI Client — Main Ink Application
 *
 * Renders the full interactive terminal UI:
 * - Connection status bar
 * - Conversation history (completed messages in <Static>)
 * - Streaming assistant response with tool output + thinking
 * - Extension UI dialogs
 * - Text input bar
 */

import React, { useReducer, useCallback, useState, useEffect, useRef } from "react";
import { Box, Text, Static, useApp, useStdout, useInput } from "ink";
import TextInput from "ink-text-input";
import { Connection, type ConnectionState } from "./connection.js";
import { Editor } from "./editor.js";
import { routeInput, extractCommandNames, type PiCommand } from "@marcfargas/pi-server-commands";
import {
  appReducer,
  initialState,
  extractToolText,
  formatToolArgs,
  type AppState,
  type CompletedMessage,
  type ToolExecution,
  type ExtensionUIRequest,
} from "./state.js";

// Max lines of tool output to show (avoid flooding the terminal)
const MAX_TOOL_OUTPUT_LINES = 15;

function truncateOutput(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= MAX_TOOL_OUTPUT_LINES) return text;
  return (
    lines.slice(0, MAX_TOOL_OUTPUT_LINES).join("\n") +
    `\n… (${lines.length - MAX_TOOL_OUTPUT_LINES} more lines)`
  );
}

// =============================================================================
// Main App
// =============================================================================

interface AppProps {
  url: string;
  token?: string;
}

export default function App({ url, token }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [showHelpHint, setShowHelpHint] = useState(false);
  const helpHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const columns = stdout?.columns ?? 80;

  // Discovered commands from pi (extensions, skills, templates) — for routing
  const [discoveredCommands, setDiscoveredCommands] = useState<Set<string>>(new Set());

  useEffect(() => {
    const conn = new Connection(url, {
      onStateChange: (connState: ConnectionState) => {
        dispatch({ type: "SET_CONNECTION_STATE", state: connState });
      },

      onWelcome: (welcome) => {
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

        setShowHelpHint(true);
        if (helpHintTimerRef.current) {
          clearTimeout(helpHintTimerRef.current);
        }
        helpHintTimerRef.current = setTimeout(() => {
          setShowHelpHint(false);
          helpHintTimerRef.current = null;
        }, 5_000);

        // Discover available commands from pi for routing
        conn.sendCommand({ type: "get_commands", id: "__discover_commands" });
      },

      onEvent: (payload) => {
        // Intercept get_commands response for command discovery
        const p = payload as Record<string, unknown>;
        if (p.type === "response" && p.command === "get_commands" && p.id === "__discover_commands" && p.success) {
          const data = p.data as Record<string, unknown>;
          if (data && Array.isArray(data.commands)) {
            setDiscoveredCommands(extractCommandNames(data.commands as PiCommand[]));
          }
          return; // Don't dispatch to UI — internal housekeeping
        }

        if (p.type === "error" && p.code === "PI_PROCESS_ERROR") {
          dispatch({ type: "SET_ERROR", message: "Pi agent process crashed — server needs restart" });
          conn.disconnect();
          return;
        }

        handlePiEvent(payload, dispatch);
      },

      onExtensionUI: (request) => {
        handleExtensionUI(request, dispatch);
      },

      onError: (error) => {
        if (error.code === "UNAUTHORIZED") {
          dispatch({ type: "SET_ERROR", message: "Authentication failed. Check your --token." });
          conn.disconnect();
          return;
        }

        if (error.code === "PI_PROCESS_ERROR") {
          dispatch({ type: "SET_ERROR", message: "Pi agent process crashed — server needs restart" });
          conn.disconnect();
          return;
        }

        dispatch({
          type: "SET_ERROR",
          message: `[${error.code}] ${error.message}`,
        });
      },
    }, { token });

    conn.connect();
    setConnection(conn);
    return () => {
      if (helpHintTimerRef.current) {
        clearTimeout(helpHintTimerRef.current);
        helpHintTimerRef.current = null;
      }
      conn.disconnect();
    };
  }, [url, token]);

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Add to input history (dedup consecutive)
      setInputHistory((prev) => {
        if (prev[prev.length - 1] === trimmed) return prev;
        return [...prev, trimmed];
      });

      // --- Client commands: !prefix (never clash with pi's / commands) ---
      if (trimmed === "//quit" || trimmed === "//exit") {
        connection?.disconnect();
        exit();
        return;
      }

      if (trimmed === "//help") {
        dispatch({
          type: "USER_MESSAGE",
          content: [
            "Client: //quit //help //clear //status",
            "Everything else goes to pi — /commands, /skills, text",
            "Enter to send · Shift+Enter for newline · ↑↓ for history",
          ].join("\n"),
        });
        return;
      }

      if (trimmed === "//clear") {
        dispatch({ type: "LOAD_HISTORY", messages: [] });
        return;
      }

      if (trimmed === "//status") {
        const info = state.serverInfo;
        dispatch({
          type: "USER_MESSAGE",
          content: `Connection: ${state.connectionState} | Server: ${info?.serverId ?? "?"} | Model: ${info?.model ?? "?"} | Protocol: v${info?.protocolVersion ?? "?"}`,
        });
        return;
      }

      // --- Route through shared command library ---
      const route = routeInput(trimmed, discoveredCommands);

      if (route.kind === "builtin") {
        // Builtin command → send as typed RPC command
        connection?.sendCommand(route.rpc);
        return;
      }

      // Text or prompt (extension/skill/unknown slash command)
      const message = route.message;
      if (state.isAgentBusy) {
        dispatch({ type: "USER_MESSAGE", content: `[steer] ${message}` });
        connection?.sendCommand({ type: "prompt", message, streamingBehavior: "steer" });
      } else {
        dispatch({ type: "USER_MESSAGE", content: message });
        connection?.sendCommand({ type: "prompt", message });
      }
    },
    [connection, exit, state.isAgentBusy, state.serverInfo, state.connectionState, discoveredCommands],
  );

  const handleExtensionUIResponse = useCallback(
    (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      if (state.extensionUI && connection) {
        connection.sendExtensionUIResponse(state.extensionUI.id, response);
        dispatch({ type: "EXTENSION_UI_DISMISS" });
      }
    },
    [state.extensionUI, connection],
  );

  const canInput = state.connectionState === "connected" && !state.extensionUI;

  return (
    <Box flexDirection="column" width={columns}>
      <Static items={state.completedMessages}>
        {(msg) => <MessageView key={msg.id} message={msg} />}
      </Static>

      <Box flexDirection="column">
        <StatusBar state={state} />

        {showHelpHint && (
          <Box marginLeft={1}>
            <Text dimColor>Type //help for commands</Text>
          </Box>
        )}

        {state.errorMessage && (
          <Box marginLeft={1}>
            <Text color="red">⚠ {state.errorMessage}</Text>
          </Box>
        )}

        {state.isAgentBusy && (
          <StreamingArea
            text={state.streamingText}
            thinking={state.streamingThinking}
            tools={state.streamingTools}
          />
        )}

        {state.extensionUI && (
          <ExtensionUIDialog
            key={state.extensionUI.id}
            request={state.extensionUI}
            onRespond={handleExtensionUIResponse}
          />
        )}

        {canInput ? (
          <Editor
            onSubmit={handleSubmit}
            active={canInput}
            prefix={state.isAgentBusy ? "⏳" : "❯"}
            prefixColor={state.isAgentBusy ? "yellow" : "green"}
            placeholder={state.isAgentBusy ? "Type to interrupt..." : "Type a message..."}
            history={inputHistory}
          />
        ) : (
          <Box>
            <Text color="gray">
              {state.isAgentBusy ? "⏳" : "❯"}{" "}
            </Text>
            {state.connectionState !== "connected" ? (
              <Text dimColor>Connecting...</Text>
            ) : (
              <Text dimColor>Extension dialog active</Text>
            )}
          </Box>
        )}
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
// Tool Call View
// =============================================================================

function ToolCallView({ tool, streaming }: { tool: ToolExecution; streaming?: boolean }) {
  const output = streaming ? tool.output : tool.result;
  const displayOutput = output ? truncateOutput(output) : undefined;

  return (
    <Box flexDirection="column" marginLeft={2} marginTop={0}>
      <Box>
        <Text color={tool.isError ? "red" : "yellow"}>
          {tool.done ? (tool.isError ? "✗" : "✓") : "⟳"}{" "}
        </Text>
        <Text color="yellow" bold>{tool.name}</Text>
        {tool.args && <Text dimColor> {tool.args}</Text>}
      </Box>
      {displayOutput && (
        <Box marginLeft={4} flexDirection="column">
          <Text dimColor>{displayOutput}</Text>
        </Box>
      )}
    </Box>
  );
}

// =============================================================================
// Message View (completed messages in <Static>)
// =============================================================================

function MessageView({ message }: { message: CompletedMessage }) {
  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="blue">You</Text>
        <Box marginLeft={2}>
          <Text>{message.content}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">Assistant</Text>
      {message.thinking && (
        <Box marginLeft={2}>
          <Text dimColor italic>💭 {truncateOutput(message.thinking)}</Text>
        </Box>
      )}
      {message.tools?.map((tool) => (
        <ToolCallView key={tool.id} tool={tool} />
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
  thinking,
  tools,
}: {
  text: string;
  thinking: string;
  tools: ToolExecution[];
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">Assistant</Text>
      {thinking && !text && (
        <Box marginLeft={2}>
          <Text dimColor italic>💭 {truncateOutput(thinking)}</Text>
        </Box>
      )}
      {tools.map((tool) => (
        <ToolCallView key={tool.id} tool={tool} streaming />
      ))}
      {text ? (
        <Box marginLeft={2}>
          <Text>{text}</Text>
        </Box>
      ) : !thinking && tools.length === 0 ? (
        <Box marginLeft={2}>
          <Text dimColor>Thinking...</Text>
        </Box>
      ) : null}
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
  onRespond: (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

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

  if (request.method === "confirm") {
    return <ExtensionUIConfirm request={request} onRespond={onRespond} />;
  }

  if (request.method === "input" || request.method === "editor") {
    return <ExtensionUIInput request={request} onRespond={onRespond} />;
  }

  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>Extension UI: {request.method} "{request.title}" — not implemented</Text>
    </Box>
  );
}

function ExtensionUISelect({
  request, options, selectedIndex, onSelect, onRespond,
}: {
  request: ExtensionUIRequest;
  options: Array<{ label: string; value: string }>;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onRespond: (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}) {
  useEffect(() => {
    if (options.length > 0) return;
    const timer = setTimeout(() => onRespond({ cancelled: true }), 2_000);
    return () => clearTimeout(timer);
  }, [options.length, onRespond]);

  const safeIndex = options.length > 0
    ? Math.max(0, Math.min(selectedIndex, options.length - 1))
    : 0;

  useInput((_input, key) => {
    if (key.escape) {
      onRespond({ cancelled: true });
      return;
    }

    if (options.length === 0) {
      return;
    }

    if (key.upArrow) onSelect(Math.max(0, safeIndex - 1));
    else if (key.downArrow) onSelect(Math.min(options.length - 1, safeIndex + 1));
    else if (key.return) onRespond({ value: options[safeIndex]!.value });
  });

  if (options.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text bold color="red">{request.title ?? "Select"}</Text>
        <Text color="red">Error: no options provided by extension.</Text>
        <Text dimColor>Cancelling in 2s…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">{request.title ?? "Select"}</Text>
      {request.message && <Text>{request.message}</Text>}
      {options.map((opt, i) => (
        <Text key={opt.value} color={i === safeIndex ? "cyan" : undefined}>
          {i === safeIndex ? "❯" : " "} {opt.label}
        </Text>
      ))}
      <Text dimColor>↑↓ to navigate · Enter to select · Esc to cancel</Text>
    </Box>
  );
}

function ExtensionUIConfirm({
  request, onRespond,
}: {
  request: ExtensionUIRequest;
  onRespond: (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}) {
  useInput((input, key) => {
    if (input === "y" || input === "Y") onRespond({ confirmed: true });
    else if (input === "n" || input === "N" || key.escape) onRespond({ confirmed: false });
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">{request.title ?? "Confirm"}</Text>
      {request.message && <Text>{request.message}</Text>}
      <Text dimColor>y/n to confirm · Esc to cancel</Text>
    </Box>
  );
}

function ExtensionUIInput({
  request, onRespond,
}: {
  request: ExtensionUIRequest;
  onRespond: (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}) {
  const [inputValue, setInputValue] = useState(request.defaultValue ?? "");

  useInput((_input, key) => {
    if (key.escape) {
      onRespond({ cancelled: true });
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">{request.title ?? "Input"}</Text>
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
      const evt = payload.assistantMessageEvent as Record<string, unknown> | undefined;
      if (!evt) break;
      if (evt.type === "text_delta" && typeof evt.delta === "string") {
        dispatch({ type: "TEXT_DELTA", delta: evt.delta });
      } else if (evt.type === "thinking_delta" && typeof evt.delta === "string") {
        dispatch({ type: "THINKING_DELTA", delta: evt.delta });
      }
      break;
    }

    case "tool_execution_start": {
      const toolCallId = (payload.toolCallId as string) ?? `tool-${Date.now()}`;
      const name = (payload.toolName as string) ?? "unknown";
      const argsObj = (payload.args as Record<string, unknown>) ?? {};
      dispatch({ type: "TOOL_START", id: toolCallId, name, args: formatToolArgs(name, argsObj) });
      break;
    }

    case "tool_execution_update": {
      const toolCallId = payload.toolCallId as string;
      if (toolCallId && payload.partialResult) {
        const pr = payload.partialResult as Record<string, unknown>;
        const text = extractToolText(pr.content);
        if (text) {
          dispatch({ type: "TOOL_UPDATE", id: toolCallId, output: text });
        }
      }
      break;
    }

    case "tool_execution_end": {
      const toolCallId = payload.toolCallId as string;
      if (toolCallId && payload.result) {
        const result = payload.result as Record<string, unknown>;
        const text = extractToolText(result.content);
        dispatch({
          type: "TOOL_END",
          id: toolCallId,
          result: text,
          isError: (payload.isError as boolean) ?? false,
        });
      }
      break;
    }

    case "auto_retry_start": {
      const attempt = payload.attempt as number;
      const max = payload.maxAttempts as number;
      const errMsg = payload.errorMessage as string;
      dispatch({ type: "SET_ERROR", message: `Retrying (${attempt}/${max}): ${errMsg}` });
      break;
    }

    case "auto_retry_end": {
      if (payload.success) {
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
      const resp = payload as Record<string, unknown>;
      if (resp.success === false) {
        const error = (resp.error as string) ?? "Unknown error";
        dispatch({ type: "SET_ERROR", message: error });
      }
      break;
    }
  }
}

function handleExtensionUI(
  request: Record<string, unknown>,
  dispatch: React.Dispatch<import("./state.js").AppAction>,
): void {
  const method = request.method as string;
  const id = request.id as string;

  if (method === "notify") {
    dispatch({ type: "SET_ERROR", message: `ℹ ${request.message as string}` });
    return;
  }
  if (method === "setStatus" || method === "setWidget" || method === "setTitle") {
    return; // Silently ignore for now
  }

  if (method === "select" || method === "confirm" || method === "input" || method === "editor") {
    dispatch({
      type: "EXTENSION_UI_REQUEST",
      request: {
        id,
        method: method as ExtensionUIRequest["method"],
        title: request.title as string | undefined,
        message: request.message as string | undefined,
        options: request.options as Array<{ label: string; value: string }> | undefined,
        defaultValue: request.defaultValue as string | undefined,
      },
    });
  }
}
