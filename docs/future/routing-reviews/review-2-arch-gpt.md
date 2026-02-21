# Architecture Review — GPT-5.3-codex

## Summary Verdict
The problem statement is real and important, but this design **needs work before implementation**. The core idea (centralize command routing once in the server) is sound, yet the current proposal conflicts with your own project principles in `C:/dev/pi-server/.pi/AGENTS.md`, introduces avoidable coupling to pi internals, and leaves key behavioral contracts undefined (async lifecycle, multi-client consistency, parsing/precedence rules). If you proceed as written, you'll reduce client duplication but create a brittle compatibility surface in the server.

## Strengths
- Clear articulation of the upstream RPC gap (builtin vs extension split), consistent with the RPC notes in `C:/Users/marc/.pi/todos/bc720a3c.md`.
- Correct architectural intent: put protocol ugliness in one place instead of every client.
- Good focus on additive rollout (phased plan, protocol v1 compatibility awareness).
- `stateChanges` concept is useful for UI responsiveness and avoiding frequent `get_state` polling.
- Builtin command catalog as data (not scattered conditionals) is the right direction if you accept this approach.

## Critical Issues
1. **Direct conflict with project architecture principles**
   - **What's wrong:** The vision hardcodes builtin slash commands and RPC mappings, while `C:/dev/pi-server/.pi/AGENTS.md` explicitly says "Relay, don't interpret" and "Do NOT hardcode slash commands/RPC names."
   - **Why it matters:** This is not a minor implementation detail; it is a strategic architecture reversal. Without explicit policy change, the codebase will have contradictory rules and constant churn.
   - **What to do instead:** Decide explicitly:
     - Either **A)** keep relay purity and move normalization to a shared client SDK package, or
     - **B)** formally update project principles to allow a **bounded compatibility adapter** in server, behind a feature flag (`unifiedCommands: true`) and with strict versioned ownership.

2. **Ambiguous execution path can misroute user intent**
   - **What's wrong:** "Intercept prompts and route slash commands" risks treating ordinary text starting with `/...` as commands (or vice versa), and conflicts with pi's own parsing behavior.
   - **Why it matters:** You can silently change semantics and break trust ("I typed text, server executed control command").
   - **What to do instead:** Add an explicit wire message for command execution (e.g., `execute_command`) and keep `prompt` pass-through untouched. Clients decide when user intent is "command mode."

3. **Async command lifecycle is underspecified**
   - **What's wrong:** Commands like `/compact` may start async work; proposal only defines immediate envelope and mentions open question.
   - **Why it matters:** UIs need deterministic lifecycle: accepted, running, completed, failed, aborted; otherwise you'll have ghost states and duplicate indicators across clients.
   - **What to do instead:** Introduce command correlation IDs and lifecycle events (`command_ack`, `command_progress`, `command_done`, `command_error`) or explicitly defer normalization for async commands in v1.

4. **State consistency across multiple clients is not designed**
   - **What's wrong:** `stateChanges` is returned to the caller, but no explicit rule for broadcasting resulting state updates to other connected clients.
   - **Why it matters:** At 2+ clients, UIs will diverge ("model changed here, not there").
   - **What to do instead:** Make state update propagation explicit: every stateful command triggers a broadcast state event (or periodic authoritative `get_state` sync after command completion).

5. **Protocol contract not fully versioned**
   - **What's wrong:** New message types/endpoints are proposed but no concrete compatibility matrix or `PROTOCOL_VERSION` policy for clients that partially implement them.
   - **Why it matters:** You'll create subtle breakages between server/client versions in monorepo and external clients.
   - **What to do instead:** Define version negotiation now: required/optional capabilities, fallback behavior, and when to bump `PROTOCOL_VERSION`.

## Suggestions
- Keep v1 minimal: implement only `get_all_commands` + `execute_command`; postpone `get_completions` convenience endpoint unless clients truly need it.
- Avoid exposing internal RPC names in `completionSource`; use logical identifiers (`models`, `forkMessages`) so backend internals can change.
- Define command precedence/collision rules (what if extension introduces `model` name?).
- Specify argument parsing grammar (quoting, escaping, whitespace) to avoid client/server inconsistencies.
- Add drift detection CI against pi versions (smoke tests for mapped builtins, response shapes, and fallback behavior).
- Treat unknown builtin mappings as explicit errors with fallback guidance, not silent prompt pass-through (which can leak control text to LLM unexpectedly).

## Questions for the Author
1. Are you intentionally changing the "Relay, don't interpret" principle? If yes, where is the updated architectural boundary documented?
2. Should unified commands be default or opt-in per client/session?
3. What is the intended behavior when command names collide between builtins and extensions?
4. How will multi-client state synchronization work after a command executed by one client?
5. What pi version range must this support, and how will you detect/handle upstream RPC drift?
6. Do you want `prompt` to remain raw forever, with command execution only via explicit command messages?
7. For async commands (`compact`, potentially others), what lifecycle contract should clients rely on?
