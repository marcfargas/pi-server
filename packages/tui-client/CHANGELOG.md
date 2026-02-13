# @marcfargas/pi-client

## 0.2.0

### Minor Changes

- [`d2a555a`](https://github.com/marcfargas/pi-server/commit/d2a555a047c8a552c4c3bdf183dee4b036f51b5f) Thanks [@marcfargas](https://github.com/marcfargas)! - Initial alpha release — detachable agent sessions for pi over WebSocket.

  - **Server**: headless daemon wrapping pi's RPC mode, WebSocket relay, extension UI bridging with timeout fallbacks
  - **Client**: terminal TUI built with Ink — streaming text, tool call indicators, steer-while-streaming, auto-reconnect with full state restoration
  - **Protocol**: versioned wire protocol (v1) with typed handshake, event streaming, and extension UI request/response framing

### Patch Changes

- Updated dependencies [[`d2a555a`](https://github.com/marcfargas/pi-server/commit/d2a555a047c8a552c4c3bdf183dee4b036f51b5f)]:
  - @marcfargas/pi-server-protocol@0.2.0
