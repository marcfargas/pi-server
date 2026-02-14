# Review Synthesis: Unified Command Layer

**Date**: 2026-02-14  
**Reviewers**: Claude Sonnet 4.5 (architecture + implementation), GPT-5.3-codex (architecture + implementation)

---

## Unanimous Verdicts

All four reviewers converge on these points:

1. **The problem is real** — The builtin/extension command split genuinely creates client complexity and duplicated routing logic. The vision document correctly identifies an upstream protocol gap.

2. **Fundamental architectural conflict exists** — The proposal directly violates the project's core principle: *"Relay, don't interpret"* and *"Do NOT hardcode slash commands, RPC command names, or capability lists."* This isn't acknowledged in the design document.

3. **Catalog drift is the critical risk** — Hardcoding 28 builtin commands from pi's `rpc-mode.js` creates a maintenance burden. When pi adds/changes/removes commands, the server catalog becomes stale with no automated detection. This will cause silent failures where commands route incorrectly.

4. **Phase 3 (stateChanges) is underspecified and risky** — Extracting state changes from heterogeneous RPC responses couples the server to pi's internal response formats. This creates a shadow state machine that will break when pi changes. The complexity is underestimated.

5. **Design needs work before implementation** — Multiple critical contracts are undefined: async command lifecycle, multi-client state synchronization, protocol versioning, argument parsing rules, error handling, and failure modes.

---

## Key Divergences

### Severity Assessment

**Architecture reviewers** (both Claude and GPT) emphasize the principle violation as a strategic architectural decision requiring explicit policy change. Claude's architecture review is most absolute: *"the wrong solution for this architecture."*

**Implementation reviewers** (both models) are more pragmatic, focusing on "if you build this, here's how to do it safely" with detailed mitigation strategies for catalog drift, state sync, and testing.

### Recommended Path Forward

**Claude (architecture)**: Narrow scope drastically or solve upstream. Three alternatives:
- (A) Minimal routing — server checks `get_commands`, no hardcoded catalog
- (B) Contribute to pi — make `get_commands` return builtins
- (C) Hybrid discovery — build catalog at runtime by introspecting pi

**GPT (architecture)**: Decide explicitly whether to change the principle, then either:
- (A) Keep relay purity, move normalization to shared client SDK
- (B) Formally update principles, add feature flag, strict versioning

**Claude (implementation)**: Ship Phase 1 only for MVP. Cut Phase 2-3 until you have usage data proving the value. Focus on bulletproof routing.

**GPT (implementation)**: Realistic 4-6 day Phase 1, 2-3 day Phase 2, 3-5 day Phase 3. Cut generic picker complexity and full diff sophistication for v1.

### Over-Engineering Assessment

**Claude (architecture)** emphasizes this strongly: You're building an entire command framework (catalog, dispatch, schemas, versioning, state extraction) to save ~500 lines of client code, while creating:
- A catalog of 28+ commands to maintain
- Protocol versioning burden
- Testing surface mirroring pi's tests
- Drift risk with every pi release

**GPT reviewers** acknowledge the complexity but focus more on making the implementation safe if you proceed.

---

## Critical Issues (Must Address)

Listed in order of blocking severity:

### 1. **Architectural Principle Violation** (BLOCKING)
**What**: Design proposes hardcoding builtin commands, directly violating `.pi/AGENTS.md` directive to "Relay, don't interpret" and "Do NOT hardcode slash commands."

**Why it matters**: This is a strategic reversal, not an implementation detail. Without explicit policy change, the codebase will have contradictory rules.

**Required action**: Make an explicit architectural decision and document it:
- Either abandon server-side routing and move this to a shared client library
- Or formally update project principles to allow a bounded compatibility adapter with feature flag and versioned ownership
- Cannot proceed with current design without resolving this contradiction

### 2. **Catalog Drift and Maintenance** (BLOCKING)
**What**: No automated way to detect when pi's builtin commands change. The TODO (bc720a3c) already notes missing `/tree` command.

**Why it matters**: Silent failures where commands route incorrectly (user types `/export`, server sends it as prompt to LLM instead of routing to new RPC command).

**Required action** (if proceeding):
- Build CI test that compares catalog against pi's actual command set
- Define which pi version(s) are supported
- Add "known unknowns" fallback for commands not in catalog
- Document the catalog sync process (manual updates? automated tests?)

### 3. **Ambiguous Execution Path** (BLOCKING)
**What**: "Intercept prompts and route slash commands" risks misrouting user intent. Text starting with `/` could be ordinary text, not a command.

**Why it matters**: Silent semantic changes break user trust ("I typed text, server executed a control command").

**Required action**: Add explicit wire message type for command execution (e.g., `execute_command`) and keep `prompt` pass-through untouched. Clients decide when user intent is "command mode."

### 4. **Async Command Lifecycle Undefined** (BLOCKING)
**What**: Commands like `/compact` start async work. Proposal only defines immediate envelope response.

**Why it matters**: UIs need deterministic states (accepted, running, completed, failed, aborted). Without this, you'll have ghost states and duplicate progress indicators.

**Required action**: Either introduce command correlation IDs and lifecycle events (`command_ack`, `command_progress`, `command_done`, `command_error`) OR explicitly defer async command normalization in v1.

### 5. **Multi-Client State Consistency Not Designed** (BLOCKING)
**What**: `stateChanges` returned to caller, but no rule for broadcasting state updates to other connected clients.

**Why it matters**: At 2+ clients, UIs will diverge ("model changed here, not there").

**Required action**: Make state propagation explicit — every stateful command triggers broadcast state event to all clients (or authoritative `get_state` sync after command completion).

### 6. **Protocol Versioning Incomplete** (BLOCKING)
**What**: New message types proposed but no compatibility matrix or version negotiation policy.

**Why it matters**: Subtle breakages between server/client versions in monorepo and external clients.

**Required action**: Define now: required vs optional capabilities, fallback behavior, when to bump `PROTOCOL_VERSION`, how clients discover server capabilities.

### 7. **stateChanges Couples to pi Internals** (CRITICAL)
**What**: `extractStateChanges` parses every builtin command response. When `set_model` format changes, server breaks.

**Why it matters**: Maintaining a shadow state machine for 28+ commands is brittle and high-maintenance.

**Alternative**: Just call `get_state` after every command. Profile first — if it's actually a bottleneck, optimize then. Claude (arch) and GPT (impl) both suggest this.

---

## Suggestions (Should Address)

Grouped by theme:

### Scope Reduction
- **Cut Phase 3 for MVP** (unanimous from implementation reviews) — Ship Phase 1 (routing) + Phase 2 (completion data). State change notifications are premature optimization. Clients already call `get_state` today; profile before optimizing.
- **Start with 5 commands, not 28** (Claude impl) — `/model`, `/thinking`, `/abort`, `/new`, `/compact`. Expand after proving the pattern works.
- **Defer generic picker complexity** (GPT impl) — `/fork` picker and broad completion framework can come later.

### Alternative Architectures
- **Shared client SDK instead of server logic** (both arch reviews) — If the problem is duplicated client code, solve it with a library, not protocol changes.
- **Fix upstream in pi** (Claude arch) — If `get_commands` returning builtins solves 80% of the problem, contribute a PR instead of building a workaround layer.
- **Minimal routing without catalog** (Claude arch) — Server checks if slash command is in `get_commands` result. If no, try parsing as builtin. Unknown commands fall through to `prompt` (pi decides validity).

### Design Specifics
- **Define wire contract first** (GPT impl) — New message types, compatibility strategy, and schemas before any code.
- **Use logical identifiers in completionSource** (GPT arch) — Not internal RPC names like `get_available_models`. Use `models`, `forkMessages` so internals can change.
- **Specify argument parsing grammar** (GPT arch) — Quoting, escaping, whitespace rules to avoid client/server inconsistencies.
- **Return only changed fields in stateChanges** (Claude impl) — Lighter on wire, explicit about causality. Clients merge into their state.
- **Keep args raw where possible** (GPT impl) — Per-command validators, structured validation errors.

### Testing & Operations
- **Add drift detection CI** (both arch reviews, Claude impl) — Smoke tests for mapped builtins, response shapes, fallback behavior.
- **Test failure cases for each builtin** (Claude impl) — Error responses must wrap consistently.
- **Document pi version compatibility** (Claude impl, GPT arch) — Which pi version(s) are supported, how to detect drift.
- **Add integration tests for edge cases** (Claude impl) — `/model  ` (trailing space), `/model google/` (incomplete ID), ambiguous inputs.

### Protocol Design
- **Use server-reserved ID namespace** (GPT impl) — Separate pending maps for internal vs client commands to avoid correlation bugs.
- **Distinguish accepted vs completed** (GPT impl) — Extension commands are "accepted now, complete later." Don't confuse clients.
- **Advertise capabilities in welcome** (GPT impl) — Or version bump. Let clients know what the server supports.
- **Command precedence/collision rules** (GPT arch) — What if extension introduces a `model` command name?

---

## Open Questions

These need answers before proceeding:

### Policy & Strategy
1. **Is the architectural principle change intentional?** Are you explicitly deciding to change "Relay, don't interpret" to allow server-side command routing? If yes, where will the updated boundary be documented? (Both arch reviewers)

2. **Why not contribute this upstream to pi?** If `get_commands` returning builtins solves 80% of the problem, why build a workaround layer instead of a PR? (Claude arch)

3. **What's the actual pain point today?** Is this a problem clients are hitting now, or speculative complexity for future clients? If the TUI works fine with the current split, is this premature? (Claude arch)

4. **Should unified commands be default or opt-in?** Per client? Per session? Feature flag? (GPT arch)

### Technical Contracts
5. **How will catalog sync work operationally?** When pi releases a new builtin (like the missing `/tree`), what's your process? Manual code updates? Automated tests that fail? (Both arch reviewers, Claude impl)

6. **What happens to unknown builtins?** If pi adds a command and a client tries it before you've updated the catalog, does it fail? Fall through to `prompt`? (Claude arch, GPT arch)

7. **How will multi-client state sync work?** After a command executed by one client, how do other clients learn about state changes? (Both arch reviewers)

8. **What is the async command lifecycle contract?** For `/compact` and potentially others, what states should clients rely on? (Both arch reviewers, GPT impl)

9. **Command name collision behavior?** What if an extension introduces a command with the same name as a builtin? (GPT arch)

10. **Should `prompt` remain raw forever?** With command execution only via explicit command messages? Or will you intercept prompts that start with `/`? (GPT arch)

### Scope & Edge Cases
11. **What about bash commands?** The catalog doesn't mention `bash`, `abort_bash`, `steer`, `abort_retry`. Handled? Not worth exposing? (Claude arch)

12. **Session switching interaction?** `switch_session` changes all state. Do you re-send `stateChanges` for everything? Re-call `get_state`? (Claude arch)

13. **Command aliases?** Does `/m` work as shorthand for `/model`? Where is aliasing handled? (Claude impl)

14. **Have you profiled the `get_state` alternative?** Building `stateChanges` extraction avoids one RPC call. What's the actual latency? Is the optimization worth the complexity? (Claude arch)

---

## Concrete Next Actions

In priority order:

### 1. **Make an architectural decision** (REQUIRED BEFORE ANY CODE)
Write a document explicitly addressing:
- Are you changing the "Relay, don't interpret" principle? Yes/No.
- If yes: updated architectural boundary, feature flag approach, versioning policy.
- If no: alternative approach (shared client SDK, upstream contribution, minimal routing).
- Update `.pi/AGENTS.md` accordingly.

### 2. **Answer the open questions** (REQUIRED FOR DESIGN COMPLETION)
Specifically the policy questions (#1-4) and technical contracts (#5-10). These define the system's behavior and cannot be deferred.

### 3. **If proceeding: Define wire protocol contract**
Before writing code:
- Exact schemas for new message types (`execute_command`, `command_result`, `get_all_commands`)
- Correlation model (request IDs)
- Compatibility mechanism (capabilities in `welcome` vs version bump)
- Error response format
- State synchronization broadcast rules

### 4. **If proceeding: Design catalog maintenance strategy**
- Build drift detection test against pi
- Document supported pi version(s)
- Define catalog update process
- Add "known unknowns" fallback for unmapped commands

### 5. **If proceeding: Cut scope for MVP**
Start with:
- Phase 1 only (routing + discovery)
- 5 commands, not 28
- No `stateChanges` — clients call `get_state` as needed
- No generic picker complexity

Defer until proven necessary:
- Phase 2 (completion endpoints)
- Phase 3 (state change extraction)
- Advanced features (aliases, argument validation, fuzzy matching)

### 6. **If proceeding: Implementation sequence** (GPT impl's order)
1. Define wire contract (schemas, compatibility)
2. Extract builtin catalog module (data + dispatch + validators)
3. Implement router in `ws-server.ts`
4. Add `get_all_commands` endpoint
5. Add command execution path
6. Add normalized response envelope + correlation
7. Testing pass (unit + integration)

### 7. **Consider alternatives seriously**
The architecture reviews raise a fundamental question: are you solving the problem at the right layer?

**Alternative 1**: Shared client library (`@pi-server/client-utils`)
- Encapsulates command routing logic
- Clients import and use directly
- Server stays pure relay
- No protocol changes, no catalog drift risk

**Alternative 2**: Contribute to pi upstream
- Make `get_commands` return builtins with schemas
- Solves the problem for everyone
- No workaround layer needed
- Aligns with project principles

**Alternative 3**: Minimal relay enhancement
- Server doesn't interpret commands
- Just provides metadata endpoints (`/api/models`, `/api/thinking-levels`)
- Clients build their own completion UIs
- Server remains stateless and protocol-agnostic

---

## Final Recommendation

**Do not proceed with the current design.** The architectural conflict with project principles is blocking, and the benefits (saving ~500 lines of duplicated client code) don't justify the costs (catalog maintenance, protocol complexity, principle violation, drift risk, coupling to pi internals).

**Recommended path**: 
1. Build a **shared client library** (`packages/client-utils`) that encapsulates command routing, argument parsing, and completion logic. Clients import this library. Server stays as pure relay.
2. If that doesn't solve enough of the problem, **contribute upstream to pi** to make `get_commands` return builtin commands with argument schemas.
3. Only if both alternatives are infeasible should you revisit server-side routing — and then only with explicit architectural principle change, feature flag, strict versioning, and automated drift detection.

The design is well-researched and thoughtfully structured, but it's solving the right problem at the wrong layer. Either move the solution to where it belongs (client library or upstream), or make an explicit architectural decision to accept the trade-offs of server-side interpretation.
