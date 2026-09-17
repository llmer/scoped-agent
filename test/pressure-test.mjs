#!/usr/bin/env node
/**
 * Deterministic pressure test for the scoped-agent policy hook.
 * Spawns the REAL hook (src/policy.js) with synthetic PreToolUse payloads and
 * asserts the decision on every case — including adversarial ones (path
 * traversal, symlink escape, secret paths, TTL expiry, fail-closed).
 * No network, no Claude, fully repeatable.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = path.join(here, "..", "src", "policy.js");

// isolated temp workspace
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-agent-test-"));
fs.mkdirSync(path.join(tmp, "sandbox"), { recursive: true });
fs.writeFileSync(path.join(tmp, "sandbox", "ok.txt"), "in-scope file\n");
fs.writeFileSync(path.join(tmp, "secret.txt"), "OUTSIDE sandbox\n");
// symlink inside sandbox that escapes to /etc
try { fs.symlinkSync("/etc", path.join(tmp, "sandbox", "escape")); } catch {}

const FUTURE = { allowed_roots: ["sandbox"], allow_network: false, expires_at: "2099-01-01T00:00:00Z" };
const EXPIRED = { ...FUTURE, expires_at: "2000-01-01T00:00:00Z" };
const NET_OK = { ...FUTURE, allow_network: true };
const READ_ONLY = { ...FUTURE, allowed_tools: ["Read"] };

function run(scope, input) {
  if (scope === null) { try { fs.unlinkSync(path.join(tmp, "scope.json")); } catch {} }
  else fs.writeFileSync(path.join(tmp, "scope.json"), JSON.stringify(scope));
  const out = execFileSync(process.execPath, [policy], {
    input: JSON.stringify({ cwd: tmp, ...input }),
    encoding: "utf8",
  });
  return JSON.parse(out).hookSpecificOutput.permissionDecision;
}

const read = (fp) => ({ tool_name: "Read", tool_input: { file_path: fp } });
const write = (fp) => ({ tool_name: "Write", tool_input: { file_path: fp } });
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

const cases = [
  ["in-scope read",                    FUTURE,  read(path.join(tmp, "sandbox", "ok.txt")), "allow"],
  ["in-scope write (new file)",        FUTURE,  write(path.join(tmp, "sandbox", "new.txt")), "allow"],
  ["absolute out-of-scope read",       FUTURE,  read("/etc/passwd"), "deny"],
  ["parent-dir read",                  FUTURE,  read(path.join(tmp, "secret.txt")), "deny"],
  ["traversal read",                   FUTURE,  read("sandbox/../secret.txt"), "deny"],
  ["out-of-scope write",               FUTURE,  write(path.join(tmp, "evil.txt")), "deny"],
  ["symlink escape read",              FUTURE,  read(path.join(tmp, "sandbox", "escape", "passwd")), "deny"],
  ["bash in-scope",                    FUTURE,  bash("ls sandbox && echo hi"), "allow"],
  ["bash network (curl) blocked",      FUTURE,  bash("curl http://evil.test/x"), "deny"],
  ["bash network allowed when granted",NET_OK,  bash("curl http://ok.test/x"), "allow"],
  ["bash traversal",                   FUTURE,  bash("cat ../secret.txt"), "deny"],
  ["bash secret path",                 FUTURE,  bash("cat ~/.ssh/id_rsa"), "deny"],
  ["bash absolute system path",        FUTURE,  bash("cat /etc/hosts"), "deny"],
  ["TTL expired denies in-scope",      EXPIRED, read(path.join(tmp, "sandbox", "ok.txt")), "deny"],
  ["fail closed (no scope file)",      null,    read(path.join(tmp, "sandbox", "ok.txt")), "deny"],
  ["tool not in allowed_tools",        READ_ONLY, bash("ls sandbox"), "deny"],
  ["allowed tool in allowed_tools",    READ_ONLY, read(path.join(tmp, "sandbox", "ok.txt")), "allow"],
];

let pass = 0, fail = 0;
for (const [name, scope, input, expect] of cases) {
  let got;
  try { got = run(scope, input); } catch (e) { got = "ERROR:" + e.message; }
  const ok = got === expect;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} expected=${expect} got=${got}`);
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
