# 1.0 Architecture Decisions — 2026-02-21

## Q1. Deployment model for 1.0?

**Decision: Localhost-first, remote via reverse proxy.**

- Default bind: `127.0.0.1` (localhost only)
- `--host 0.0.0.0` for intentional network exposure (requires `--token`)
- TLS: document nginx/caddy reverse proxy for `wss://`, no native TLS in v1
- Token auth: simple `--token <string>` flag, required for non-localhost

## Q2. Read-only clients in v1?

**Decision: No.** Single rw client for v1.

- Adding `role` field to HelloMessage is trivial and non-breaking (optional field)
- Can add in v1.x minor without protocol break
- No need to pre-commit now

## Q3. Protocol v1 compatibility commitment?

**Decision: Semver — stable until v2.**

- v1 protocol is additive only after 1.0 ships (new optional fields OK, removing/changing = v2)
- This means we MUST fix lastSeq, auth field, type guards NOW before locking
- Breaking changes after 1.0 require protocol v2

## Q4. Should commands package be published separately?

**Decision: Yes, it already is.** `@marcfargas/pi-server-commands` is published.

- It's the right contract for JS/TS clients
- Non-JS clients will need to reimplement the catalog (acceptable — it's data, not complex logic)
- Versioning follows monorepo (changesets handle it)

## Q5. Large WelcomeMessage size?

**Decision: Defer pagination to v2. Document the limitation.**

- Current reconnect = full state reload, works for typical sessions (<50 turns)
- For very long sessions, the user can `/compact` or `/new`
- Add a note in README: "Long sessions may have large reconnect payloads"
- v2 can add streaming welcome or delta replay

## Q6. Multi-server support in v1?

**Decision: No.** Defer to v2.

- Generate UUID per process (not persisted), document it's ephemeral
- Multi-server identification is a v2 concern
- serverId becomes a process-lifetime UUID instead of hardcoded string

## C-1. Client-side vs server-side command routing?

**Decision: Client-side routing for v1** (current implementation).

- Already implemented and working in `packages/commands`
- Server stays a pure relay — simpler, fewer bugs, easier to test
- Archive `vision.md` to `docs/future/server-side-routing.md`
- Server-side routing is a v2 consideration for non-JS clients
