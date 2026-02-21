# pi-server

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
# Terminal 1 — start the server (localhost only, no auth needed)
npx pi-server serve -- --provider google --model gemini-2.5-flash

# Terminal 2 — connect
npx pi-client connect ws://localhost:3333
```

Type a message, see streaming responses. Close the client, reopen it — your conversation is still there.

### With authentication (required for network access)

```bash
# Server — expose on network with token auth
npx pi-server serve --host 0.0.0.0 --token mysecret -- --provider anthropic --model claude-sonnet-4-5

# Client — provide matching token
npx pi-client connect ws://server:3333 --token mysecret
```

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| `@marcfargas/pi-server` | Headless daemon — wraps pi over WebSocket | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-server)](https://www.npmjs.com/package/@marcfargas/pi-server) |
| `@marcfargas/pi-client` | Terminal TUI client (Ink) | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-client)](https://www.npmjs.com/package/@marcfargas/pi-client) |
| `@marcfargas/pi-server-protocol` | Wire protocol types | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-server-protocol)](https://www.npmjs.com/package/@marcfargas/pi-server-protocol) |
| `@marcfargas/pi-server-commands` | Shared command routing library | [![npm](https://img.shields.io/npm/v/@marcfargas/pi-server-commands)](https://www.npmjs.com/package/@marcfargas/pi-server-commands) |

Unscoped convenience packages (`pi-server`, `pi-client`) are thin wrappers that delegate to the scoped packages above. They exist to [prevent supply-chain attacks](packages/wrappers/) via npm name squatting.

## Server Options

```
pi-server serve [options] [-- pi-options...]

Server options (before --):
  --port, -p <number>    WebSocket port (default: 3333)
  --host <address>       Bind address (default: 127.0.0.1 — localhost only)
  --token <string>       Auth token clients must provide (auto-generated for network)
  --cwd <path>           Working directory for pi (default: current dir)
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
pi-server serve --host 0.0.0.0 --token mysecret -- --no-extensions
pi-server serve --cwd /path/to/project -- --no-skills
```

## Security

**Default: localhost only.** The server binds to `127.0.0.1` by default — only local connections accepted.

**Network access requires authentication.** When using `--host 0.0.0.0`, a `--token` is required (auto-generated if not provided). Clients must supply the matching token via `--token`.

**TLS (wss://).** Pi-server does not implement native TLS. For encrypted connections, use a reverse proxy:

```nginx
# nginx — wss:// termination
server {
    listen 443 ssl;
    server_name pi.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

## Client Commands

The TUI client supports client-local commands (prefixed `//` to avoid clashing with pi's `/` commands):

| Command | Description |
|---------|-------------|
| `//help` | Show available client commands |
| `//quit` / `//exit` | Disconnect and exit |
| `//clear` | Clear displayed conversation |
| `//status` | Show connection info, model, protocol version |

Everything else — text, `/model`, `/thinking`, `/compact`, extension commands — goes to pi.

## Protocol

The server relays pi's [RPC protocol](https://github.com/mariozechner/pi-coding-agent/blob/main/docs/rpc.md) over WebSocket with a thin framing layer:

1. Client connects → sends `HelloMessage` with protocol version and optional auth token
2. Server validates token (if configured) and protocol version
3. Server responds with `WelcomeMessage` containing full session state
4. Steady state: client sends commands, server streams events with monotonic sequence numbers
5. Server sends keepalive pings every 30s; terminates unresponsive connections
6. On reconnect: server re-sends full state — client renders from scratch

**Protocol version: v1** — versioned from day one. Additive changes only after 1.0 (new optional fields OK); breaking changes require protocol v2.

See [`packages/protocol/`](packages/protocol/) for the wire types.

### Reconnect behavior

On reconnect, the server sends the complete session state and message history in the `WelcomeMessage`. The client re-renders from scratch. There is no delta replay in v1.

> **Note**: For very long sessions (200+ turns), the `WelcomeMessage` may be large. Use `/compact` to reduce context size.

## Architecture

```
packages/
  protocol/       Wire protocol types, versioning, error codes
  commands/       Shared command routing library (builtin catalog + router)
  server/         PiProcess (spawn pi), WsServer (WebSocket), UIBridge (extension UI)
  tui-client/     Connection manager, Ink TUI app (React), multi-line editor
  wrappers/       Unscoped npm name reservations
```

**Design principles:**

1. **The server is a relay, not an interpreter.** Pi's JSON messages pass through unchanged. The server adds WebSocket transport, connection lifecycle, and extension UI bridging.

2. **Command routing lives in the client.** The `commands` package provides a shared library that maps `/model`, `/thinking`, etc. to their RPC equivalents. Clients import this — the server doesn't parse commands.

3. **Protocol is the contract.** All packages import types from `@marcfargas/pi-server-protocol`. Breaking protocol changes require a version bump.

4. **Extension UI bridging.** Fire-and-forget events (notify, setStatus) are broadcast. Dialog requests (select, confirm, input) are routed to the connected client with a configurable timeout and default fallback.

## Features

- **Streaming responses** — text deltas, thinking blocks, tool execution lifecycle
- **Tool output** — bash commands, file reads/writes, with truncation for large outputs
- **Extension UI** — select, confirm, input, editor dialogs bridged from pi extensions
- **Multi-line editor** — Enter to send, Shift+Enter for newlines, ↑↓ for history
- **Command routing** — `/model`, `/thinking`, `/compact`, `/abort`, `/new`, `/stats`, `/fork`, `/export` all work
- **Token authentication** — `--token` flag for secure access
- **Connection health** — server-side keepalive pings, exponential backoff reconnect on client
- **Error handling** — pi process crash notification, startup error detection, graceful shutdown

## Requirements

- Node.js ≥ 22
- [pi](https://github.com/mariozechner/pi-coding-agent) installed globally
- API key for your chosen LLM provider

## License

MIT
