# @marcfargas/pi-client

## 0.3.0

### Minor Changes

- [`d62cc3f`](https://github.com/marcfargas/pi-server/commit/d62cc3f0b038f194e9b9f29bcd335aef8e1dcbeb) Thanks [@marcfargas](https://github.com/marcfargas)! - Full TUI for coding sessions — tool output, thinking, multi-line editor.

  - **Tool output rendering**: full lifecycle with ✓/✗ indicators, streaming partial output, truncation at 15 lines. Bash shows command text, read/write/edit show file path.
  - **Thinking blocks**: streaming 💭 display while model reasons, dimmed and hidden once text starts.
  - **Multi-line text editor**: Enter for newlines, Ctrl+D to submit, arrow key navigation, block cursor.
  - **Message history**: Up/Down arrows recall previous prompts with draft preservation.
  - **Client commands**: `//quit`, `//help`, `//clear`, `//status` — double-slash prefix avoids clashes with pi's `/` and `!` commands. Everything else passes through to pi.

### Patch Changes

- Updated dependencies [[`d62cc3f`](https://github.com/marcfargas/pi-server/commit/d62cc3f0b038f194e9b9f29bcd335aef8e1dcbeb)]:
  - @marcfargas/pi-server-protocol@0.3.0

## 0.2.0

### Minor Changes

- [`d2a555a`](https://github.com/marcfargas/pi-server/commit/d2a555a047c8a552c4c3bdf183dee4b036f51b5f) Thanks [@marcfargas](https://github.com/marcfargas)! - Initial alpha release — detachable agent sessions for pi over WebSocket.

  - **Server**: headless daemon wrapping pi's RPC mode, WebSocket relay, extension UI bridging with timeout fallbacks
  - **Client**: terminal TUI built with Ink — streaming text, tool call indicators, steer-while-streaming, auto-reconnect with full state restoration
  - **Protocol**: versioned wire protocol (v1) with typed handshake, event streaming, and extension UI request/response framing

### Patch Changes

- Updated dependencies [[`d2a555a`](https://github.com/marcfargas/pi-server/commit/d2a555a047c8a552c4c3bdf183dee4b036f51b5f)]:
  - @marcfargas/pi-server-protocol@0.2.0
