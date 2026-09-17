# scoped-agent

Run a Claude Code agent with **zero standing permissions**: every run gets a grant that is path-scoped, time-boxed, auto-revoked, and fully logged. Before the run there is no access; after it, the grant is expired. In between, the agent can only touch what you granted, and you get a complete record of everything it tried.

No new infrastructure. It's a ~90-line PreToolUse hook that becomes the sole permission authority for the run, plus a thin runner. Stock Claude Code.

```
  scoped-agent  ·  grant: [sandbox]  ·  ttl 300s  ·  network off
  task: read this project's git remote from ../.git/config, and also read /etc/hosts

  ACCESS LOG  ------------------------------------------------------------------
  decision  tool   target                            reason
  ------------------------------------------------------------------------------
  DENY      Read   ../.git/config                    out of scope: outside [sandbox]
  DENY      Read   /etc/hosts                        out of scope: outside [sandbox]
  ------------------------------------------------------------------------------
  2 tool calls · 0 allowed · 2 denied
```

## Why

A coding agent usually runs with the same standing access you have: your whole filesystem, your shell, the network. The now-familiar "agent deleted my prod database / wiped my files" stories are all the same shape — unscoped, unaudited write access. The fix everyone converges on is least privilege: one narrow grant per run, expiring, with an audit trail. `scoped-agent` is that, for Claude Code, in a form you can drop into a repo.

## Quickstart

```bash
git clone <this repo> && cd scoped-agent
npm test          # 17/17 — the policy pressure test (traversal, symlink escape, TTL, fail-closed)
npm run demo      # runs a real agent under a grant: fixes a test in scope, then hits the leash
```

Run it on your own task:

```bash
node bin/scoped-agent.mjs \
  --dir ./my-project \
  --roots src,tests \
  --ttl 300 \
  --task "fix the failing test in ./tests"
```

## What it enforces

- **Zero standing permissions.** No scope file present ⇒ every call is denied (fail closed). The runner mints a grant only for the duration of the task.
- **Path scope on the argument, not the tool.** `Read` is allowed, but a `Read` of `/etc/passwd` or `../secrets` is denied. Coarse allowlists (`--allowedTools Read`) can't do this; the hook checks the resolved, realpath'd target against the granted roots, so `..` traversal and escaping symlinks are caught.
- **Time-boxed + auto-revoked.** The grant carries a TTL. Once it elapses (or the run ends) every call is denied — "access auto-revoked."
- **Network off by default.** `curl`/`wget`/`ssh`/etc. in a `Bash` call are denied unless you pass `--allow-network`.
- **Full audit log.** Every attempt — allowed or denied, with a reason — is appended to `access-log.jsonl` and printed as a table.

## How it works

Claude Code fires a `PreToolUse` hook before every tool call, passing the call as JSON on stdin. `src/policy.js` reads it, checks it against `scope.json`, appends the decision to the log, and returns a `permissionDecision` of `allow` or `deny`. Because the hook returns an explicit decision, it *is* the permission authority for the run — there is no prompt to click through and no standing allowlist to over-grant.

`scope.json` (minted per run by the runner):

```json
{
  "allowed_roots": ["sandbox"],
  "allow_network": false,
  "ttl_seconds": 300,
  "expires_at": "2026-09-17T20:05:00Z"
}
```

## What this is and isn't

- It **is** a least-privilege control plane at the tool-call layer, with an audit trail — enforced by Claude Code, not advisory.
- It is **not** an OS sandbox/jail. It governs the agent's tool calls; it does not contain a process that has already escaped the agent (e.g. a script the agent writes and runs that itself opens files). For hard isolation, run it inside a container with the same scope. This is defense at the decision layer, and a clean record of what was decided.

## Tests

`npm test` runs a deterministic suite that feeds the real hook adversarial tool-calls — path traversal, symlink escape, secret paths (`~/.ssh`, `.env`), network commands, TTL expiry, and the fail-closed case — and asserts every decision. 17/17.

## License

MIT
