#!/usr/bin/env node
/**
 * Deterministic pressure test for the scoped-agent policy hook.
 * Spawns the REAL hook (src/policy.js) with synthetic PreToolUse payloads and
 * asserts the decision on every case — enforcement, adversarial escapes, the
 * inert/fail-closed modes, and the leash-protection + grant-channel invariants.
 * No network, no Claude, fully repeatable.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = path.join(here, "..", "src", "policy.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-agent-test-"));
fs.mkdirSync(path.join(tmp, "sandbox"), { recursive: true });
fs.writeFileSync(path.join(tmp, "sandbox", "ok.txt"), "in-scope file\n");
fs.writeFileSync(path.join(tmp, "secret.txt"), "OUTSIDE sandbox\n");
try { fs.symlinkSync("/etc", path.join(tmp, "sandbox", "escape")); } catch {}

const FUTURE = { allowed_roots: ["sandbox"], allow_network: false, expires_at: "2099-01-01T00:00:00Z" };
const EXPIRED = { ...FUTURE, expires_at: "2000-01-01T00:00:00Z" };
const NET_OK = { ...FUTURE, allow_network: true };
const READ_ONLY = { ...FUTURE, allowed_tools: ["Read"] };

const scopeFile = path.join(tmp, "scope.json");
const policyFile = path.join(tmp, ".scoped-agent.json");

function run(scope, input, policyPresent = false) {
  if (scope === null) { try { fs.unlinkSync(scopeFile); } catch {} }
  else fs.writeFileSync(scopeFile, JSON.stringify(scope));
  if (policyPresent) fs.writeFileSync(policyFile, JSON.stringify({ roots: ["sandbox"], ttl_seconds: 300 }));
  else { try { fs.unlinkSync(policyFile); } catch {} }
  const out = execFileSync(process.execPath, [policy], { input: JSON.stringify({ cwd: tmp, ...input }), encoding: "utf8" });
  if (!out.trim()) return "defer";
  return JSON.parse(out).hookSpecificOutput.permissionDecision;
}

const read = (fp) => ({ tool_name: "Read", tool_input: { file_path: fp } });
const write = (fp) => ({ tool_name: "Write", tool_input: { file_path: fp } });
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const ok = path.join(tmp, "sandbox", "ok.txt");

const cases = [
  // [name, scope, input, expect, policyPresent]
  ["in-scope read",                     FUTURE,  read(ok), "allow"],
  ["in-scope write (new file)",         FUTURE,  write(path.join(tmp, "sandbox", "new.txt")), "allow"],
  ["absolute out-of-scope read",        FUTURE,  read("/etc/passwd"), "deny"],
  ["parent-dir read",                   FUTURE,  read(path.join(tmp, "secret.txt")), "deny"],
  ["traversal read",                    FUTURE,  read("sandbox/../secret.txt"), "deny"],
  ["out-of-scope write",                FUTURE,  write(path.join(tmp, "evil.txt")), "deny"],
  ["symlink escape read",               FUTURE,  read(path.join(tmp, "sandbox", "escape", "passwd")), "deny"],
  ["bash in-scope",                     FUTURE,  bash("ls sandbox && echo hi"), "allow"],
  ["bash network blocked",              FUTURE,  bash("curl http://evil.test/x"), "deny"],
  ["bash network allowed when granted", NET_OK,  bash("curl http://ok.test/x"), "allow"],
  ["bash traversal",                    FUTURE,  bash("cat ../secret.txt"), "deny"],
  ["bash secret path",                  FUTURE,  bash("cat ~/.ssh/id_rsa"), "deny"],
  ["bash absolute system path",         FUTURE,  bash("cat /etc/hosts"), "deny"],
  ["TTL expired denies in-scope",       EXPIRED, read(ok), "deny"],
  ["tool not in allowed_tools",         READ_ONLY, bash("ls sandbox"), "deny"],
  ["allowed tool in allowed_tools",     READ_ONLY, read(ok), "allow"],
  // invariants
  ["cannot write scope.json",           FUTURE,  write(path.join(tmp, "scope.json")), "deny"],
  ["cannot write .scoped-agent.json",   FUTURE,  write(path.join(tmp, ".scoped-agent.json")), "deny"],
  ["sanctioned grant channel allowed",  FUTURE,  bash("node /x/scoped-agent/src/set-scope.mjs sandbox 5m"), "allow"],
  // modes
  ["inert when not opted in",           null,    read(ok), "defer", false],
  ["fail-closed: policy but no grant",  null,    read(ok), "deny",  true],
];

let pass = 0, fail = 0;
for (const [name, scope, input, expect, policyPresent] of cases) {
  let got;
  try { got = run(scope, input, policyPresent); } catch (e) { got = "ERROR:" + e.message; }
  const good = got === expect;
  good ? pass++ : fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name.padEnd(38)} expected=${expect} got=${got}`);
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
