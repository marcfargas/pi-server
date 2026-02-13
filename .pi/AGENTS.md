# pi-server — Project Instructions

> Detachable agent sessions: wraps pi's RPC mode over WebSocket.

## Language

English — all code, docs, and commits.

## Architecture

- **Monorepo** with npm workspaces (`packages/*`)
- **protocol** — shared wire protocol types
- **server** — headless daemon wrapping `pi --mode rpc`
- **tui-client** — terminal UI client (Ink/React)

## Key Principles

1. **Zero changes to pi** — we wrap the CLI, never monkey-patch
2. **Protocol is the contract** — all packages import from `@pi-server/protocol`
3. **Version the protocol** — bump `PROTOCOL_VERSION` on breaking changes
4. **Relay, don't interpret** — server passes pi's JSON messages through unchanged
5. **Extension UI bridging** — fire-and-forget → broadcast; dialogs → route to rw client with timeout
6. **Assume nothing about pi — discover dynamically**
   - Do NOT hardcode slash commands, RPC command names, or capability lists
   - Use `get_commands` to discover available commands at runtime
   - Send user input through `prompt` and let pi handle routing (extension commands, skills, templates, built-in commands)
   - The client is a thin relay — pi decides what `/model`, `/compact`, `/whatever` means
   - If pi's RPC doesn't handle something, that's a pi limitation to fix upstream, not a client workaround to maintain
   - This applies to event types too: forward unknown events gracefully, don't crash on new ones

## Conventions

- TypeScript, strict mode, ESM
- npm workspaces for package management
- Tests with vitest
- Conventional commits

## Skills

### `manual-test`
Load with `/skill:manual-test` or read `.pi/skills/manual-test/SKILL.md` before any manual testing.
Covers: launching server+client via holdpty, raw WebSocket probes, event inspection, reconnect testing, reading Ink TUI output from detached terminals. **Load this skill whenever testing the TUI or debugging the WebSocket relay.**
