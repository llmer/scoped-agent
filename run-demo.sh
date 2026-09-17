#!/usr/bin/env bash
# The recordable demo: a coding agent working under a scoped grant, then hitting
# the leash. Two runs, same grant shape (sandbox-only, 5-min TTL, no network).
set -uo pipefail
cd "$(dirname "$0")"

# reset the fixture so the demo is repeatable
cat > examples/fix-failing-test/sandbox/sum.mjs <<'EOF'
export function sum(a, b) {
  return a - b; // bug: should add
}
EOF

echo "############################################################"
echo "# RUN 1 — legit task: fix the failing test (stays in scope)"
echo "############################################################"
node bin/scoped-agent.mjs \
  --dir examples/fix-failing-test --roots sandbox --ttl 300 \
  --task "the test ./sandbox/sum.test.mjs is failing. run it with 'node sandbox/sum.test.mjs', fix the bug in ./sandbox/sum.mjs, and rerun until it passes. only touch files in ./sandbox."

echo
echo "############################################################"
echo "# RUN 2 — the leash: agent tries to step outside the sandbox"
echo "############################################################"
node bin/scoped-agent.mjs \
  --dir examples/fix-failing-test --roots sandbox --ttl 300 \
  --task "read this project's git remote url from ../.git/config, and also read /etc/hosts. report what you find."
