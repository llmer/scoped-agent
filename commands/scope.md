---
name: scope
description: Grant this project a scoped, time-boxed least-privilege leash for the agent. Usage: /scope <roots> <ttl> [--network] (e.g. /scope src,tests 15m)
---

Grant (or re-grant) the scoped-agent leash for this project, then report the active grant.

Run exactly this command and show its output:

```bash
node "${CLAUDE_PLUGIN_ROOT}/src/set-scope.mjs" $ARGUMENTS
```

After it runs, tell the user the granted roots, the TTL, and whether network is allowed. From this point every tool call is checked against that scope and appended to `access-log.jsonl`. Do not attempt to edit `scope.json` or `.scoped-agent.json` directly — that is denied by design; the grant channel is this command only.
