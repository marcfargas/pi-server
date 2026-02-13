/**
 * State reducer tests — tool execution, thinking blocks, history parsing.
 */

import { describe, it, expect } from "vitest";
import { appReducer, initialState, extractToolText, type AppState } from "../src/state.js";

// =============================================================================
// Helpers
// =============================================================================

function reduce(state: AppState, ...actions: Parameters<typeof appReducer>[1][]): AppState {
  return actions.reduce((s, a) => appReducer(s, a), state);
}

const agentStarted = reduce(initialState, { type: "AGENT_START" });

// =============================================================================
// Tool execution lifecycle
// =============================================================================

describe("tool execution", () => {
  it("TOOL_START adds a tool to streamingTools", () => {
    const state = reduce(agentStarted, {
      type: "TOOL_START",
      id: "tc-1",
      name: "bash",
      args: "ls -la",
    });

    expect(state.streamingTools).toHaveLength(1);
    expect(state.streamingTools[0]).toEqual({
      id: "tc-1",
      name: "bash",
      args: "ls -la",
    });
  });

  it("TOOL_UPDATE replaces output for the matching tool", () => {
    const state = reduce(
      agentStarted,
      { type: "TOOL_START", id: "tc-1", name: "bash", args: "ls" },
      { type: "TOOL_UPDATE", id: "tc-1", output: "file1.txt\nfile2.txt" },
    );

    expect(state.streamingTools[0]!.output).toBe("file1.txt\nfile2.txt");
  });

  it("TOOL_UPDATE does not affect other tools", () => {
    const state = reduce(
      agentStarted,
      { type: "TOOL_START", id: "tc-1", name: "bash", args: "ls" },
      { type: "TOOL_START", id: "tc-2", name: "read", args: "README.md" },
      { type: "TOOL_UPDATE", id: "tc-2", output: "# Hello" },
    );

    expect(state.streamingTools[0]!.output).toBeUndefined();
    expect(state.streamingTools[1]!.output).toBe("# Hello");
  });

  it("TOOL_END marks tool as done with result", () => {
    const state = reduce(
      agentStarted,
      { type: "TOOL_START", id: "tc-1", name: "bash", args: "ls" },
      { type: "TOOL_UPDATE", id: "tc-1", output: "partial..." },
      { type: "TOOL_END", id: "tc-1", result: "file1.txt\nfile2.txt", isError: false },
    );

    expect(state.streamingTools[0]!.done).toBe(true);
    expect(state.streamingTools[0]!.result).toBe("file1.txt\nfile2.txt");
    expect(state.streamingTools[0]!.isError).toBe(false);
  });

  it("TOOL_END with error marks isError", () => {
    const state = reduce(
      agentStarted,
      { type: "TOOL_START", id: "tc-1", name: "bash", args: "rm -rf /" },
      { type: "TOOL_END", id: "tc-1", result: "Permission denied", isError: true },
    );

    expect(state.streamingTools[0]!.isError).toBe(true);
    expect(state.streamingTools[0]!.result).toBe("Permission denied");
  });

  it("tools are committed to completed message on AGENT_END", () => {
    const state = reduce(
      agentStarted,
      { type: "TOOL_START", id: "tc-1", name: "bash", args: "ls" },
      { type: "TOOL_END", id: "tc-1", result: "files", isError: false },
      { type: "TEXT_DELTA", delta: "Found the files." },
      { type: "AGENT_END" },
    );

    expect(state.streamingTools).toEqual([]);
    expect(state.completedMessages).toHaveLength(1);
    const msg = state.completedMessages[0]!;
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("Found the files.");
    expect(msg.tools).toHaveLength(1);
    expect(msg.tools![0]!.name).toBe("bash");
    expect(msg.tools![0]!.result).toBe("files");
  });

  it("multiple tools in one turn", () => {
    const state = reduce(
      agentStarted,
      { type: "TOOL_START", id: "tc-1", name: "bash", args: "ls" },
      { type: "TOOL_END", id: "tc-1", result: "files", isError: false },
      { type: "TOOL_START", id: "tc-2", name: "read", args: '{"path":"x.ts"}' },
      { type: "TOOL_END", id: "tc-2", result: "const x = 1;", isError: false },
      { type: "TEXT_DELTA", delta: "Done." },
      { type: "AGENT_END" },
    );

    const msg = state.completedMessages[0]!;
    expect(msg.tools).toHaveLength(2);
    expect(msg.tools![0]!.name).toBe("bash");
    expect(msg.tools![1]!.name).toBe("read");
  });
});

// =============================================================================
// Thinking blocks
// =============================================================================

describe("thinking blocks", () => {
  it("THINKING_DELTA accumulates thinking text", () => {
    const state = reduce(
      agentStarted,
      { type: "THINKING_DELTA", delta: "Let me " },
      { type: "THINKING_DELTA", delta: "think about this." },
    );

    expect(state.streamingThinking).toBe("Let me think about this.");
  });

  it("thinking is preserved in completed message", () => {
    const state = reduce(
      agentStarted,
      { type: "THINKING_DELTA", delta: "I need to check..." },
      { type: "TEXT_DELTA", delta: "Here's the answer." },
      { type: "AGENT_END" },
    );

    const msg = state.completedMessages[0]!;
    expect(msg.thinking).toBe("I need to check...");
    expect(msg.content).toBe("Here's the answer.");
  });

  it("thinking is cleared on AGENT_START", () => {
    const state = reduce(
      agentStarted,
      { type: "THINKING_DELTA", delta: "thinking..." },
      { type: "AGENT_END" },
      { type: "AGENT_START" },
    );

    expect(state.streamingThinking).toBe("");
  });
});

// =============================================================================
// History parsing
// =============================================================================

describe("history parsing (LOAD_HISTORY)", () => {
  it("parses user and assistant messages", () => {
    const state = reduce(initialState, {
      type: "LOAD_HISTORY",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
      ],
    });

    expect(state.completedMessages).toHaveLength(2);
    expect(state.completedMessages[0]!.role).toBe("user");
    expect(state.completedMessages[0]!.content).toBe("Hello");
    expect(state.completedMessages[1]!.role).toBe("assistant");
    expect(state.completedMessages[1]!.content).toBe("Hi there!");
  });

  it("parses tool calls with results from toolResult messages", () => {
    const state = reduce(initialState, {
      type: "LOAD_HISTORY",
      messages: [
        { role: "user", content: "List files" },
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "tc-1", name: "bash", arguments: { command: "ls" } },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tc-1",
          content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
          isError: false,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Found 2 files." }],
        },
      ],
    });

    // User + assistant(tools) + assistant(text)
    expect(state.completedMessages).toHaveLength(3);

    const toolMsg = state.completedMessages[1]!;
    expect(toolMsg.tools).toHaveLength(1);
    expect(toolMsg.tools![0]!.name).toBe("bash");
    expect(toolMsg.tools![0]!.result).toBe("file1.txt\nfile2.txt");
    expect(toolMsg.tools![0]!.done).toBe(true);
  });

  it("parses thinking blocks from history", () => {
    const state = reduce(initialState, {
      type: "LOAD_HISTORY",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Let me consider..." },
            { type: "text", text: "The answer is 42." },
          ],
        },
      ],
    });

    const msg = state.completedMessages[0]!;
    expect(msg.thinking).toBe("Let me consider...");
    expect(msg.content).toBe("The answer is 42.");
  });
});

// =============================================================================
// extractToolText
// =============================================================================

describe("extractToolText", () => {
  it("extracts text from content array", () => {
    const result = extractToolText([
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
    ]);
    expect(result).toBe("line 1\nline 2");
  });

  it("handles string input", () => {
    expect(extractToolText("just a string")).toBe("just a string");
  });

  it("handles null/undefined", () => {
    expect(extractToolText(null)).toBe("");
    expect(extractToolText(undefined)).toBe("");
  });

  it("filters non-text blocks", () => {
    const result = extractToolText([
      { type: "text", text: "hello" },
      { type: "image", data: "..." },
      { type: "text", text: "world" },
    ]);
    expect(result).toBe("hello\nworld");
  });
});

// =============================================================================
// Agent lifecycle edge cases
// =============================================================================

describe("agent lifecycle", () => {
  it("AGENT_END with no content produces no completed message", () => {
    const state = reduce(agentStarted, { type: "AGENT_END" });
    expect(state.completedMessages).toHaveLength(0);
    expect(state.isAgentBusy).toBe(false);
  });

  it("AGENT_END with only thinking produces a completed message", () => {
    const state = reduce(
      agentStarted,
      { type: "THINKING_DELTA", delta: "hmm..." },
      { type: "AGENT_END" },
    );
    expect(state.completedMessages).toHaveLength(1);
    expect(state.completedMessages[0]!.thinking).toBe("hmm...");
  });

  it("USER_MESSAGE adds to completed messages", () => {
    const state = reduce(initialState, {
      type: "USER_MESSAGE",
      content: "Hello!",
    });
    expect(state.completedMessages).toHaveLength(1);
    expect(state.completedMessages[0]!.role).toBe("user");
  });
});
