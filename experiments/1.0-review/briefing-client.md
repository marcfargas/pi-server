# Briefing: TUI Client Polish for v1.0

## Your working root
`C:/dev/pi-server-wt-client/` — a git worktree. All edits go here. Commit when done.

## Context
Read these files first:
- `experiments/1.0-review/synthesis.md` — full review with issues
- `experiments/1.0-review/decisions.md` — architecture decisions
- `packages/tui-client/src/app.tsx` — main Ink application
- `packages/tui-client/src/state.ts` — state reducer
- `packages/tui-client/src/connection.ts` — WebSocket connection manager
- `packages/tui-client/src/editor.tsx` — text input editor
- `packages/tui-client/src/cli.ts` — CLI entry point

The protocol package and connection.ts have already been updated (on develop, merged into your worktree):
- Reconnect race fixed (socket captured locally, stale guards)
- Exponential backoff with jitter added
- Token support added to Connection + CLI

## Tasks (in priority order)

### 1. Guard extension dialog empty options (B-2)
File: `packages/tui-client/src/app.tsx`
- In `ExtensionUISelect`, check `options.length > 0` before rendering.
- If empty, show error text and auto-cancel after 2s.
- Clamp `selectedIndex` to valid range: `Math.min(selectedIndex, options.length - 1)`.

### 2. Fix extension dialog state leak (B-3)
File: `packages/tui-client/src/app.tsx`
- Add `useEffect` to reset `inputValue` and `selectedIndex` when `request.id` changes.
- Or better: add `key={request.id}` to the `ExtensionUIDialog` component to force remount.

### 3. Move messageCounter into reducer (B-5)
File: `packages/tui-client/src/state.ts`
- Move `let messageCounter = 0` into `AppState` as `nextMessageId: number`.
- Update reducer to increment from state, not module scope.
- This fixes HMR leaks and makes the reducer pure.

### 4. Add error boundary for history parsing (B-6)
File: `packages/tui-client/src/state.ts`
- Wrap `parseHistoryMessages()` body in try/catch.
- On error, log to stderr and return empty array (don't crash Ink).

### 5. Make //help discoverable (B-7)
File: `packages/tui-client/src/app.tsx`
- On successful connect (after welcome), show a dim one-liner: "Type //help for commands"
- Can be a transient message that clears after 5s, or just a dim text in the status bar area.

### 6. Pass token from CLI to Connection (wire up)
File: `packages/tui-client/src/cli.ts` and `packages/tui-client/src/app.tsx`
- The CLI already parses `--token`. Pass it through to the App component as a prop.
- App passes it to `new Connection(url, events, { token })`.
- Handle UNAUTHORIZED error: show "Authentication failed. Check your --token." and don't reconnect.

### 7. Update client help text
File: `packages/tui-client/src/cli.ts`
- Add `--token` to the help output.
- Update examples to show token usage.

### 8. Handle PI_PROCESS_ERROR from server
File: `packages/tui-client/src/app.tsx`
- When an error event with code `PI_PROCESS_ERROR` arrives, show clear message: "Pi agent process crashed — server needs restart"
- Don't attempt reconnect for this error (it's not a connection issue).

## Acceptance Criteria
- All existing tests pass (`npm test` in the worktree)
- Build succeeds (`npm run build`)
- Empty options array doesn't crash the dialog
- Dialog state resets between different requests
- messageCounter is in AppState, not module scope
- Malformed history doesn't crash the app
- `--token` flag works end-to-end
- UNAUTHORIZED error shows clear message, no reconnect loop

## When done
- `git add -A && git commit -m "feat: TUI client polish for v1.0 — dialog fixes, auth, error handling"`
- Leave the worktree — orchestrator will merge
