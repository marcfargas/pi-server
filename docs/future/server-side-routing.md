# pi-server Unified Command Layer — Vision

## Problem — What exists and why it's not good enough

pi-server wraps pi's `--mode rpc` over WebSocket so multiple client UIs (TUI, web dashboard, future UIs) can connect to a headless agent. But pi's RPC protocol has a split personality for commands:

1. **Extension/skill commands** (`/todos`, `/plan`, `/skill:web-search`) — discovered via `get_commands`, dispatched via `prompt`. Return `{success: true}` and communicate through side-effect events (`extension_ui_request`).

2. **Builtin commands** (`/model`, `/compact`, `/thinking`, `/abort`, `/new`, `/stats`, `/name`) — NOT in `get_commands`, NOT dispatchable via `prompt` (sent as LLM text). Must be sent as typed RPC messages (`cycle_model`, `compact`, `set_thinking_level`, etc.) with command-specific response shapes.

This means every client must:
- Know the split exists
- Maintain a hardcoded mapping of slash names → RPC types for builtins
- Route differently based on command source
- Parse different response shapes per command
- Independently implement completions/argument handling

With multiple clients planned (TUI, web, mobile), this logic would be duplicated everywhere.

## Goal — What we're building and for whom

A **Unified Command Layer** in pi-server that normalizes all commands into a single interface for clients. Clients send `/model gemini-2.5-flash` and get back a consistent response. They don't know or care whether it's a builtin or extension.

**For whom**: Any pi-server client — our TUI, a future web dashboard, third-party integrations.

### Design Goals
- Clients see ONE command interface — no builtin/extension distinction
- All commands discoverable via one endpoint with completion metadata
- Consistent response envelope for all commands
- Argument schemas for autocompletion (UI-technology agnostic)
- Server handles all routing complexity

## Current State — What exists

### pi RPC protocol (upstream, we don't control)
- 28 typed RPC commands (see full list in TODO-bc720a3c)
- `get_commands` returns extension/skill/template commands (name, description, source, path)
- `get_available_models` returns full model list (provider/id/name/cost/context)
- `get_state` returns current model, thinking level, streaming state, session info
- Extension commands execute via `prompt` and communicate through `extension_ui_request` events
- Builtin commands execute via typed RPC and return command-specific data

### pi-server today
- Pure relay — passes commands through to pi unchanged
- `WelcomeMessage` includes state snapshot on connect
- Events forwarded as-is to connected client
- No command normalization, no completion support

### What pi's TUI does internally (for reference)
- Maps `/model` → `cycle_model`, `/model x` → `set_model`
- Maps `/thinking` → `cycle_thinking_level`, `/thinking x` → `set_thinking_level`
- Shows command palette with all available commands
- Shows model picker with completion
- Shows thinking level picker

## Architecture / Design

### Layer placement

```
Client (TUI/Web/etc)
  │
  │  sends: { type: "slash_command", command: "/model", args: "google/gemini-2.5-flash" }
  │  or:    { type: "slash_command", command: "/model" }  (no args = cycle)
  │
  ▼
pi-server (Unified Command Layer)
  │
  │  routes to either:
  │  - Typed RPC: { type: "set_model", provider: "google", modelId: "gemini-2.5-flash" }
  │  - Prompt:    { type: "prompt", message: "/todos" }
  │
  ▼
pi RPC (child process)
```

### Unified command discovery

New server-side endpoint: when client sends `{ type: "get_all_commands" }`, server:
1. Calls pi's `get_commands` → extension/skill/template commands
2. Merges with codified builtin command definitions
3. Returns unified list with completion metadata

Response shape:
```json
{
  "type": "response",
  "command": "get_all_commands",
  "success": true,
  "data": {
    "commands": [
      {
        "name": "model",
        "description": "Switch model (no arg = cycle to next)",
        "source": "builtin",
        "args": {
          "type": "optional",
          "schema": {
            "type": "model_selector",
            "completionSource": "get_available_models"
          }
        }
      },
      {
        "name": "thinking",
        "description": "Set thinking level (no arg = cycle)",
        "source": "builtin",
        "args": {
          "type": "optional",
          "schema": {
            "type": "enum",
            "values": ["off", "minimal", "low", "medium", "high", "xhigh"]
          }
        }
      },
      {
        "name": "compact",
        "description": "Compact conversation context",
        "source": "builtin",
        "args": {
          "type": "optional",
          "schema": { "type": "free_text", "placeholder": "Custom instructions" }
        }
      },
      {
        "name": "abort",
        "description": "Abort current agent run",
        "source": "builtin",
        "args": { "type": "none" }
      },
      {
        "name": "new",
        "description": "Start a new session",
        "source": "builtin",
        "args": { "type": "none" }
      },
      {
        "name": "stats",
        "description": "Show token usage and cost",
        "source": "builtin",
        "args": { "type": "none" }
      },
      {
        "name": "name",
        "description": "Set session name",
        "source": "builtin",
        "args": {
          "type": "required",
          "schema": { "type": "free_text", "placeholder": "Session name" }
        }
      },
      {
        "name": "fork",
        "description": "Fork from a previous message",
        "source": "builtin",
        "args": {
          "type": "optional",
          "schema": {
            "type": "picker",
            "completionSource": "get_fork_messages"
          }
        }
      },
      {
        "name": "todos",
        "description": "List todos (current project or all)",
        "source": "extension"
      },
      {
        "name": "skill:web-search",
        "description": "Web search via ddgs",
        "source": "skill"
      }
    ]
  }
}
```

### Argument schema types (for completion)

| Type | Description | Example |
|------|-------------|---------|
| `none` | No arguments | `/abort`, `/new`, `/stats` |
| `free_text` | Arbitrary string | `/name my-session`, `/compact focus on X` |
| `enum` | Fixed set of values | `/thinking off\|low\|medium\|high` |
| `model_selector` | Provider/model ID, completable from model list | `/model google/gemini-2.5-flash` |
| `picker` | Requires a selection UI, data fetched from `completionSource` | `/fork` → shows message list |

The `completionSource` field tells the client which RPC command to call to populate the picker/autocomplete. The server can also offer a convenience endpoint that returns the pre-fetched data.

### Unified response envelope

All command responses wrapped consistently:

```json
{
  "type": "command_result",
  "command": "model",
  "success": true,
  "data": { ... },
  "stateChanges": {
    "model": { "id": "gemini-2.5-flash", "provider": "google", "name": "Gemini 2.5 Flash" },
    "thinkingLevel": "off"
  }
}
```

The `stateChanges` field is the key innovation — it tells the client exactly what state changed so it can update its UI without polling `get_state`. For builtins, the server computes this from the RPC response. For extensions, it's omitted (extensions communicate via events).

### Builtin command codification

Each builtin defined as data in the server:

```typescript
interface BuiltinCommand {
  name: string;                              // Slash command name
  description: string;                       // Human description
  argSchema: ArgSchema;                      // For completion
  dispatch(args?: string): RpcCommand;       // Maps to typed RPC
  extractStateChanges(response: unknown): StateChanges | null;  // What changed
}
```

The dispatch function handles the logic like:
- `/model` (no args) → `{ type: "cycle_model" }`
- `/model google/gemini-2.5-flash` → `{ type: "set_model", provider: "google", modelId: "gemini-2.5-flash" }`

### What stays on the client

- Rendering the completion UI (TUI: Ink picker, Web: dropdown, etc.)
- Displaying command results and state changes
- The `//` client-only commands (`//quit`, `//help`, `//clear`, `//status`)
- Extension UI dialog rendering (`extension_ui_request` → show picker/confirm/input)

## Phases / Priority

### Phase 1: Command discovery + routing
- Define builtin command catalog (data, not scattered code)
- Implement `get_all_commands` endpoint (merge builtins + pi's get_commands)
- Implement server-side slash command routing (intercept prompts, dispatch to RPC)
- Tests for each builtin routing

### Phase 2: Completion data
- Implement completion data fetching (`get_available_models`, thinking levels)
- Add `get_completions` endpoint that returns values for a specific command
- Client-side completion UI in TUI (show `/` menu when typing)

### Phase 3: Response normalization
- Wrap builtin responses with `stateChanges`
- Extension commands return success/error envelope
- Client updates state from `stateChanges` instead of polling

## Constraints

- **Cannot modify pi** — everything is server-side wrapping
- **Protocol v1 compatibility** — new messages must be additive (old clients still work with raw relay)
- **Builtin list will change** — pi may add/remove RPC commands. Our catalog needs updating when pi updates. This is acceptable — builtins change infrequently and we test against pi's actual command set.
- **Extension responses are opaque** — no conventions, just relay events

## Risks

- **Builtin catalog drift** — pi adds a command we don't know about. Mitigation: we extracted the full list from `rpc-mode.js`, can re-check on pi updates. Unknown commands fall through as prompt.
- **Completion data freshness** — model list can change at runtime (provider goes offline). Mitigation: fetch on demand, cache briefly.
- **Over-engineering** — building a full command framework when 90% of usage is just typing text. Mitigation: keep it simple — data definitions, not abstractions.

## Open Questions

1. Should `get_all_commands` be called on every connect (welcome), or on-demand?
2. Should the server cache `get_commands` from pi, or call it fresh each time?
3. For `/fork`, should the server pre-fetch fork messages and include them in the picker schema, or should the client call `get_completions` lazily?
4. Should `stateChanges` be a diff or full state? Diff is lighter but client needs merge logic.
5. How do we handle commands that trigger agent runs (like `/compact` which starts a compaction agent run)? The response is immediate but the work is async.
