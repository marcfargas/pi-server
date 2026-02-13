# pi-server

> ⚠️ **Alpha** — Under active development. APIs will change.

Detachable agent sessions for [pi](https://github.com/mariozechner/pi-coding-agent). Run pi as a headless daemon, connect and disconnect terminal clients at will — your session keeps running.

```
┌──────────────┐        ┌──────────────┐        ┌─────────────┐
│  TUI Client  │◄══WS══►│  pi-server   │◄═stdio═►│  pi --mode  │
│  (terminal)  │        │  (daemon)    │        │  rpc        │
└──────────────┘        └──────────────┘        └─────────────┘
       ▲                                              │
       │            disconnect / reconnect             │
       └──────── session survives ─────────────────────┘
```

## Why

Pi is a powerful coding agent, but it's tied to your terminal. Close the tab, lose the session. Pi-server fixes that:

- **Detachable** — disconnect your terminal, reconnect later, pick up where you left off
- **Remote** — run pi on a beefy server, connect from your laptop
- **Multiplexable** — foundation for web dashboards, mobile clients, multi-agent orchestration

## Quick Start

```bash
# Terminal 1 — start the server
npx pi-server serve -- --provider google --model gemini-2.5-flash

# Terminal 2 — connect
npx pi-client connect ws://localhost:3333
```

Type a message, see streaming responses. Close the client, reopen it — your conversation is still there.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| `@marcfargas/pi-server` | Headless daemon — wraps pi over WebSocket | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-server)](https://www.npmjs.com/package/@marcfargas/pi-server) |
| `@marcfargas/pi-client` | Terminal TUI client (Ink) | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-client)](https://www.npmjs.com/package/@marcfargas/pi-client) |
| `@marcfargas/pi-server-protocol` | Wire protocol types | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-server-protocol)](https://www.npmjs.com/package/@marcfargas/pi-server-protocol) |

Unscoped convenience packages (`pi-server`, `pi-client`, `pi-serve`) are thin wrappers that delegate to the scoped packages above. They exist to [prevent supply-chain attacks](packages/wrappers/) via npm name squatting.

## Server Options

```
pi-server serve [options] [-- pi-options...]

Server options (before --):
  --port, -p <number>    WebSocket port (default: 3333)
  --cwd <path>           Working directory for pi
  --pi-cli-path <path>   Path to pi CLI (default: auto-detect)
  --ui-timeout <ms>      Extension UI dialog timeout (default: 60000)

Pi options (after --):
  Passed directly to pi. See pi --help. Common:
  --provider, --model, --no-session, --no-extensions, --no-skills
```

```bash
# Examples
pi-server serve -- --provider google --model gemini-2.5-flash
pi-server serve --port 9090 -- --provider anthropic --model claude-sonnet-4-5
pi-server serve --cwd /path/to/project -- --no-extensions
```

## Protocol

The server relays pi's [RPC protocol](https://github.com/mariozechner/pi-coding-agent/blob/main/docs/rpc.md) over WebSocket with a thin framing layer:

1. Client connects → sends `HelloMessage` with protocol version
2. Server responds with `WelcomeMessage` containing full session state
3. Steady state: client sends commands, server streams events
4. On reconnect: server re-sends full state — client renders from scratch

Protocol version: **v1** (versioned from day one, bumped on breaking changes).

See [`packages/protocol/`](packages/protocol/) for the wire types.

## Architecture

```
packages/
  protocol/       Wire protocol types, versioning, error codes
  server/         PiProcess (spawn pi), WsServer (WebSocket), UIBridge (extension UI)
  tui-client/     Connection manager, Ink TUI app (React)
  wrappers/       Unscoped npm name reservations
```

**Design principle**: the server is a relay, not an interpreter. Pi's JSON messages pass through unchanged. The server adds WebSocket transport, connection lifecycle, and extension UI bridging (routing dialog requests to the connected client with timeout fallbacks).

## Status

**M1 ✅ Connect and Chat**
- [x] Spawn pi in RPC mode, relay over WebSocket
- [x] Streaming text responses with Ink TUI
- [x] Reconnect with full state restoration
- [x] Provider/model configuration
- [x] E2E integration tests

**M2 🚧 Full TUI** *(in progress)*
- [ ] Tool output rendering (bash results, file contents)
- [ ] Thinking block display
- [ ] Multi-line input editor
- [ ] Extension UI dialogs (select, confirm, input)
- [ ] Status bar with extension widgets

**M3 📋 Production**
- [ ] Authentication
- [ ] TLS (wss://)
- [ ] Docker / PM2 deployment
- [ ] Documentation

## Requirements

- Node.js ≥ 22
- [pi](https://github.com/mariozechner/pi-coding-agent) installed globally
- API key for your chosen LLM provider

## License

MIT
