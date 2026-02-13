---
name: manual-test
description: >-
  Manual testing of pi-server and pi-client using holdpty detached terminals.
  Use when: testing the TUI client, verifying tool rendering, checking event
  relay, debugging WebSocket issues, running the server+client for visual
  inspection. Triggers: manual test, test the TUI, test the client, start
  server, visual test, smoke test, test rendering.
---

# Manual Testing — pi-server + pi-client

Test the full stack (server → WebSocket → client) using holdpty for detached terminals and raw WebSocket probes for event inspection.

## Prerequisites

- **holdpty** installed globally (`npm i -g holdpty` or built from `C:\dev\holdpty`)
- Project built: `npm run build` in repo root
- `.cmd` wrappers don't work with holdpty — always use `node.exe` with the `.js` entry point

## 1. Start the Server

```bash
cd /c/dev/pi-server
npm run build

holdpty launch --bg --name pi-server -- node.exe packages/server/dist/cli.js serve --port 3333 -- --provider google --model gemini-2.5-flash
```

Verify it started:

```bash
holdpty logs pi-server --tail 10
# Should show: "WebSocket listening on ws://localhost:3333"
```

## 2. Start the TUI Client

```bash
holdpty launch --bg --name pi-client -- node.exe packages/tui-client/dist/cli.js connect ws://localhost:3333
```

View the TUI (read-only, escape sequences render in your terminal):

```bash
holdpty view pi-client
# Ctrl+C to stop viewing
```

Or dump the buffer (raw escape codes, useful for grep):

```bash
holdpty logs pi-client | cat -v | head -30
```

## 3. Raw WebSocket Probe

For inspecting individual events without the TUI, connect directly via Node:

```javascript
// Save as probe.mjs or run inline with node -e
const WebSocket = (await import("ws")).default;
const ws = new WebSocket("ws://localhost:3333");

ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "hello",
    protocolVersion: 1,
    clientId: "probe",
    mode: "rw",
  }));
});

let welcomed = false;
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "welcome" && !welcomed) {
    welcomed = true;
    console.log("Connected. Model:", msg.sessionState?.model?.name);
    ws.send(JSON.stringify({
      type: "command",
      payload: { type: "prompt", message: "YOUR PROMPT HERE" },
    }));
  }

  if (msg.type === "event") {
    const p = msg.payload;
    // Log all events with full payload
    console.log(JSON.stringify(p, null, 2).slice(0, 300));
    console.log("---");
    if (p.type === "agent_end") setTimeout(() => ws.close(), 100);
  }
});

ws.on("close", () => process.exit(0));
setTimeout(() => { ws.close(); process.exit(1); }, 30000);
```

**Important**: Only one `rw` client can connect at a time. Disconnect the TUI client before probing:

```bash
holdpty stop pi-client
```

## 4. Filtered Event Inspection

To watch only specific event types:

```bash
# Tool execution events only
node -e "..." 2>&1 | grep -E "tool_execution_(start|update|end)"

# Text output only
node -e "..." 2>&1 | grep "text_delta"

# Thinking events
node -e "..." 2>&1 | grep "thinking_delta"
```

## 5. Reconnect Test

Verify that history restores correctly on reconnect:

```bash
# 1. Connect client, send prompts, tools execute
holdpty launch --bg --name pi-client -- node.exe packages/tui-client/dist/cli.js connect ws://localhost:3333

# 2. Kill the client
holdpty stop pi-client

# 3. Reconnect — should see full conversation history
holdpty launch --bg --name pi-client -- node.exe packages/tui-client/dist/cli.js connect ws://localhost:3333
holdpty logs pi-client | cat -v | grep -E "(You|Assistant|bash|read|write|edit|Connected)"
```

## 6. Reading TUI Output from holdpty

The TUI uses Ink (React) which renders with ANSI escape sequences. To extract readable text:

```bash
# Grep for meaningful content (skips positioning escapes)
holdpty logs pi-client | cat -v | grep -E "(You|Assistant|bash|read|Connected|Error)"

# Full dump with visible escape codes (for debugging rendering)
holdpty logs pi-client | cat -v | head -50
```

## 7. Cleanup

```bash
holdpty stop pi-client 2>/dev/null
holdpty stop pi-server 2>/dev/null
```

## Event Flow Reference

The full event sequence for a tool-using prompt:

```
agent_start
  turn_start
    message_start (user)
    message_end (user)
    message_start (assistant, empty content)
      message_update (toolcall_start)    ← model decides to call tool
      message_update (toolcall_delta)    ← streaming tool args
      message_update (toolcall_end)      ← tool call complete
    message_end (assistant, with toolCall)
    tool_execution_start                 ← tool actually runs
    tool_execution_update                ← streaming tool output
    tool_execution_end                   ← tool result
    message_start (toolResult)
    message_end (toolResult)
  turn_end
  turn_start                             ← new turn with tool result
    message_start (assistant)
      message_update (text_start)
      message_update (text_delta) × N    ← streaming text
      message_update (text_end)
    message_end (assistant)
  turn_end
agent_end
```

For thinking models, `thinking_delta` events appear in `message_update` before tool/text content.

## Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| Server exits immediately | Pi CLI not found | Check `where pi`, ensure pi is installed globally |
| No model responses | Wrong provider/model | Verify `--provider` and `--model` flags |
| "Another client already connected" | Previous client still connected | `holdpty stop pi-client` first |
| Empty TUI output | Ink rendering only escape codes | Use `cat -v` to see raw output, `grep` for content |
| Tool shows JSON args | `formatToolArgs` not matching | Check tool name in `state.ts formatToolArgs()` |
