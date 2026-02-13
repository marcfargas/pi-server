---
"@marcfargas/pi-server-protocol": minor
"@marcfargas/pi-server": minor
"@marcfargas/pi-client": minor
---

Initial alpha release — detachable agent sessions for pi over WebSocket.

- **Server**: headless daemon wrapping pi's RPC mode, WebSocket relay, extension UI bridging with timeout fallbacks
- **Client**: terminal TUI built with Ink — streaming text, tool call indicators, steer-while-streaming, auto-reconnect with full state restoration
- **Protocol**: versioned wire protocol (v1) with typed handshake, event streaming, and extension UI request/response framing
