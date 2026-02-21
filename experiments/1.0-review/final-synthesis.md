# v1.0 Release Review — Synthesis

**Date**: 2026-02-21  
**Reviewers**: Architecture reviewer (_arch-reviewer), Code reviewer (_code-reviewer)  
**Test Status**: ✅ All 156 tests pass, build clean

---

## Overall Verdict: **NEEDS_WORK** ❌

**Both reviewers agree**: The architecture is sound, tests are solid, but there are **real blockers** that must be fixed before calling this "v1.0 stable."

---

## Unanimous Verdicts

1. **Post-handshake message validation is missing** (Arch #3, Code #2)  
   - Server blindly casts `parsed as ClientMessage` without `isClientMessage()` check
   - Malformed messages can trigger undefined behavior in pi process relay
   - **Fix**: Add validation guard before forwarding to `handleClientMessage`

2. **Test coverage gaps in high-risk areas** (both reviewers)  
   - `editor.tsx`, `connection.ts`, `cli.ts`, `pi-process.ts` have zero or E2E-only tests
   - Reconnect logic, CLI parsing, platform-specific path detection untested
   - Not blockers, but highest post-release bug risk

3. **Protocol semantics are inconsistent** (Arch #5, Code #4)  
   - Dead error codes defined but never emitted (`SESSION_NOT_FOUND`, `EXTENSION_UI_TIMEOUT`)
   - `serverId` docs say "persists across restarts" but implementation is process-lifetime UUID
   - **Impact**: You're about to freeze protocol as v1; ambiguity now = long-term debt

---

## Key Divergences

**Architecture reviewer prioritizes security:**
- Localhost CSWSH vulnerability is a **v1-embarrassing blocker**
- Extension UI trap states are release-quality failures
- Questions whether browser clients should be supported at all

**Code reviewer prioritizes correctness:**
- Stale `dist/slash-commands.js` will ship wrong code — **critical blocker**
- CLI arg parsing bugs can bind server to all interfaces unpredictably
- TDD discipline was partial; editor/reconnect logic shipped untested

Both are right. Security and correctness both matter for v1.

---

## Critical Issues — MUST FIX Before v1.0

### 1. **Stale dist artifacts will ship in npm package** 🔴  
**Source**: Code #1  
**What**: Old `dist/slash-commands.js` returns outdated command list, conflicts with actual protocol  
**Fix**: `npm run clean && npm run build` in `packages/server`, or add `predist` hook  
**Effort**: 2 minutes  

### 2. **Post-handshake messages not validated** 🔴  
**Source**: Arch #3, Code #2  
**What**: `ws-server.ts:236` casts without `isClientMessage()` check  
**Fix**: Add validation guard, reject invalid frames  
**Effort**: 10 lines  

### 3. **Localhost mode vulnerable to browser-based WebSocket hijacking (CSWSH)** 🔴  
**Source**: Arch #1  
**What**: Any website can connect to `ws://127.0.0.1:3333` and relay to pi  
**Fix**: Minimum — reject browser `Origin` headers; Better — require token always  
**Decision needed**: Should tokenless localhost remain supported?  
**Effort**: 30 minutes + decision  

### 4. **Extension UI can trap TUI in blocked state** 🔴  
**Source**: Arch #2  
**What**: `input`/`editor` dialogs have no cancel handler, `canInput` disabled while active  
**Fix**: Add `Esc` → `{ cancelled: true }` + dismiss, local fail-safe timeout  
**Effort**: 1 hour  

### 5. **CLI arg parsing missing bounds checks** 🔴  
**Source**: Code #3  
**What**: `--host` at end-of-args → `undefined` → binds to all interfaces unpredictably  
**Fix**: Check `i + 1 < length` before `++i` for `--host`, `--token`, `--cwd`, etc.  
**Effort**: 30 minutes  

### 6. **Protocol semantics inconsistent** 🔴  
**Source**: Arch #5, Code #4  
**What**: `serverId` docs vs. implementation mismatch; dead error codes in protocol  
**Fix**: Align docs + behavior OR remove dead codes + document why  
**Decision needed**: Ephemeral or persistent `serverId`? Emit timeout errors or remove codes?  
**Effort**: 1 hour + decisions  

---

## Suggestions — SHOULD FIX (v1.0.1 patch acceptable)

### 7. **Handshake race window** 🟡  
**Source**: Arch #4  
**What**: `handshakeComplete` set before welcome sent; client can send commands during window  
**Fix**: Mark handshake complete only after welcome sent  
**Effort**: 20 minutes  

### 8. **Dead error codes in protocol** 🟡  
**Source**: Code #4 (overlaps with #6)  
**What**: `SESSION_NOT_FOUND`, `EXTENSION_UI_TIMEOUT` defined but never emitted  
**Fix**: Emit them or remove them  

### 9. **Unused parameters + missing tsconfig flags** 🟡  
**Source**: Code #5, #6  
**What**: `_connection` unused in `app.tsx`; tsconfig missing `noUnusedLocals`/`Parameters`  
**Fix**: Remove parameter, enable flags  
**Effort**: 15 minutes  

---

## Open Questions (Need Decisions Before v1.0)

1. **Are browser/Web clients in scope for v1?** (Arch reviewer)  
   → If no: reject `Origin` headers outright  
   → If yes: require explicit allowlist

2. **Should tokenless localhost remain supported?** (Arch reviewer)  
   → Current behavior is vulnerable to CSWSH  
   → Recommend: always require token, auto-generate if not provided

3. **Is `serverId` ephemeral or persistent?** (Arch reviewer)  
   → Docs say persistent, code says ephemeral  
   → Pick one, align both

4. **Should protocol validation be strict in v1?** (Arch reviewer)  
   → Or acceptable to ship lenient, tighten in v1.1?  
   → Recommend: strict now, prevent future breakage

5. **Should extension UI timeout emit `EXTENSION_UI_TIMEOUT` error?** (Code reviewer)  
   → Currently resolves silently with default  
   → If error code stays in protocol, should be emitted

---

## Nice-to-Have Improvements (v1.1+)

- **Test coverage** for `editor.tsx`, `connection.ts`, `pi-process.ts`, `cli.ts` (both reviewers)
- **Extension UI round-trip integration test** (Code #7)
- **Error logging** for WebSocket errors (Code #11) — currently silent
- **Origin rejection policy** documented in README security section (Arch)
- **State reset on reconnect** to avoid stale UI artifacts (Arch)

---

## Concrete Next Actions

### Before any v1.0 publish:

1. **Immediate** (< 5 min):  
   - Run `npm run clean && npm run build` in `packages/server` to remove stale dist

2. **Within 1 day**:  
   - Add post-handshake message validation (`isClientMessage()`)  
   - Fix CLI arg parsing bounds checks  
   - Add extension UI cancel handlers  

3. **Make decisions**:  
   - Browser clients in scope? → Sets origin policy  
   - Tokenless localhost supported? → Sets auth requirement  
   - `serverId` ephemeral or persistent? → Align docs + code  
   - Dead error codes: emit or remove? → Protocol clarity  

4. **After decisions** (2-4 hours):  
   - Implement CSWSH mitigation (origin check or mandatory token)  
   - Fix `serverId` semantics inconsistency  
   - Fix handshake race window  
   - Remove dead error codes OR wire them up  

5. **Run full test suite** + manual smoke test with real client

6. **Update README** with security guidance (localhost threat model, token usage)

---

## Go/No-Go Recommendation

**NO-GO for v1.0** until issues #1-6 are fixed.

**Why**: Stale dist artifacts (#1) will ship wrong code. Security (#3, #4), correctness (#2, #5), and protocol clarity (#6) issues are all "v1-embarrassing" — they undermine the stability promise of a 1.0 release.

**Timeline**: With decisions made, fixes are 4-6 hours of focused work. If decisions take longer, consider a 0.9.x release to unblock users while hardening for true v1.0.

**After fixes**: Re-run tests, do manual TUI smoke test, then ship.

The foundation is solid. This is **not** a major rethink — it's finishing the hardening work you started.
