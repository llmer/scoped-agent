# scoped-agent

Least privilege for coding agents. Every run gets a grant that is **path-scoped, time-boxed, auto-revoked, and fully logged**. Before the run there is no access; after it, the grant is expired. In between, the agent can only touch what you granted — and you get a complete record of everything it tried.

It's a Claude Code **plugin**: a PreToolUse hook becomes the sole permission authority for the session, a SessionStart hook auto-mints the grant, and `/scope` sets it ad-hoc. No new infrastructure, no separate process to babysit.

```
scoped-agent: granted [sandbox] for 300s (network off). every tool call is checked and logged.

  ACCESS LOG  ------------------------------------------------------------------
  decision  tool   target                            reason
  ------------------------------------------------------------------------------
  allow     Read   sandbox/config.env                in scope
  DENY      Read   /etc/hosts                        out of scope: outside [sandbox]
  ------------------------------------------------------------------------------
  2 tool calls · 1 allowed · 1 denied
```

## Why

A coding agent usually runs with the same standing access you have: your whole filesystem, your shell, the network. The now-familiar "agent deleted my prod database / wiped my files" stories are all the same shape — unscoped, unaudited write access. The fix everyone converges on is least privilege: one narrow grant per run, expiring, with an audit trail. `scoped-agent` is that, for Claude Code.

## Use it as a plugin (recommended)

```bash
# today (from a clone): load it for a session
claude --plugin-dir /path/to/scoped-agent

# once published to the marketplace
claude plugin install scoped-agent@llmer
```

Then opt a project in, either way:

- **Auto (per project):** drop a `.scoped-agent.json` in the repo. Every session auto-mints the grant at startup.
  ```json
  { "roots": ["src", "tests"], "ttl_seconds": 900, "allow_network": false }
  ```
- **Ad-hoc (in session):** `/scope src,tests 15m` (add `--network` to allow it).

From then on you use Claude Code exactly as normal — the hook enforces scope on every tool call in the background and logs each one to `access-log.jsonl`. Installing the plugin does **nothing** until a project is opted in (see modes below), so it's safe to leave installed.

## Use it as a CLI (CI / headless one-shots)

For non-interactive runs where there's no session to attach to:

```bash
node bin/scoped-agent.mjs \
  --dir ./my-project --roots src,tests --ttl 300 \
  --task "fix the failing test in ./tests"
```

Mints a grant, runs `claude -p` under the hook, auto-revokes on exit, prints the audit table.

## What it enforces

- **Zero standing permissions.** The grant exists only for the run. Opted-in project with no live grant ⇒ everything denied (fail closed).
- **Path scope on the argument, not the tool.** `Read` is allowed, but a `Read` of `/etc/passwd` or `../secrets` is denied. Coarse allowlists (`--allowedTools Read`) can't do this — the hook checks the resolved, realpath'd target against the granted roots, so `..` traversal and escaping symlinks are caught.
- **Time-boxed + auto-revoked.** The grant carries a TTL; once it elapses every call is denied ("access auto-revoked").
- **Network off by default.** `curl`/`wget`/`ssh`/etc. in a `Bash` call are denied unless you grant `--network`.
- **The agent can't edit its own leash.** Writes to `scope.json` / `.scoped-agent.json` / `access-log.jsonl` are always denied; the only way to change scope is the `/scope` grant channel.
- **Full audit log.** Every attempt — allowed or denied, with a reason — is appended to `access-log.jsonl`.

## Modes

| State | Behavior |
| --- | --- |
| no `.scoped-agent.json`, no `scope.json` | **inert** — defers to Claude Code's normal permissions (plugin does nothing) |
| policy present, grant minted | **enforcing** — allow in-scope, deny out-of-scope |
| policy present, no/expired grant | **fail closed** — deny everything |

## How it works

Claude Code fires a `PreToolUse` hook before every tool call, passing the call as JSON on stdin. `src/policy.js` reads it, checks it against `scope.json`, appends the decision to the log, and returns a `permissionDecision` of `allow` or `deny`. Because the hook returns an explicit decision, it *is* the permission authority for the run — no prompt to click through, no standing allowlist to over-grant. A `SessionStart` hook mints `scope.json` from `.scoped-agent.json`; `/scope` runs `src/set-scope.mjs` to (re)write the policy and mint immediately.

## What this is and isn't

- It **is** a least-privilege control plane at the tool-call layer, with an audit trail — enforced by Claude Code, not advisory.
- It is **not** an OS sandbox/jail. It governs the agent's tool calls; it does not contain a process the agent spawns that then opens files itself. For hard isolation, run it inside a container with the same scope.
- The `/scope` grant channel is an **operator** action. v0.1's threat model is a *wandering* agent, not one deliberately trying to escalate through the sanctioned grant script. For adversarial containment, combine with a container.

## Tests

`npm test` runs a deterministic suite that feeds the real hook adversarial tool-calls — path traversal, symlink escape, secret paths (`~/.ssh`, `.env`), network commands, TTL expiry, fail-closed, the inert mode, the leash-protection invariant, and the sanctioned grant channel — and asserts every decision. **21/21.**

## License

MIT
