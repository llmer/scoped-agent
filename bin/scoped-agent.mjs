#!/usr/bin/env node
/**
 * scoped-agent — run a Claude Code agent with zero standing permissions.
 *
 *   scoped-agent --dir ./examples/fix-failing-test \
 *                --roots sandbox --ttl 300 \
 *                --task "fix the failing test in ./sandbox"
 *
 * Mints a time-boxed, path-scoped grant, runs `claude -p` with the policy hook
 * as the sole permission authority, auto-revokes on exit, and prints the full
 * access log. No standing access: before the run there is no scope, after the
 * run the scope is expired.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const flag = (name) => process.argv.includes(`--${name}`);

const dir = path.resolve(arg("dir", "."));
const roots = arg("roots", "sandbox").split(",").map((s) => s.trim());
const ttl = parseInt(arg("ttl", "300"), 10);
const task = arg("task", "");
const allowNetwork = flag("allow-network");

if (!task) { console.error("error: --task is required"); process.exit(1); }
if (!fs.existsSync(dir)) { console.error(`error: --dir ${dir} does not exist`); process.exit(1); }

const scopePath = path.join(dir, "scope.json");
const logPath = path.join(dir, "access-log.jsonl");
const runtimeDir = path.join(dir, ".scoped-agent");
fs.mkdirSync(runtimeDir, { recursive: true });
const settingsPath = path.join(runtimeDir, "settings.json");

// mint the grant
const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
fs.writeFileSync(scopePath, JSON.stringify({ allowed_roots: roots, allow_network: allowNetwork, ttl_seconds: ttl, expires_at: expiresAt }, null, 2));
fs.writeFileSync(settingsPath, JSON.stringify({
  hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${process.execPath} ${path.join(repo, "src", "policy.js")}` }] }] },
}, null, 2));
try { fs.unlinkSync(logPath); } catch {}

console.log(`\n  scoped-agent  ·  grant: [${roots.join(", ")}]  ·  ttl ${ttl}s  ·  network ${allowNetwork ? "on" : "off"}`);
console.log(`  task: ${task}\n`);

// run the agent under the hook
const res = spawnSync("claude", [
  "-p", task,
  "--settings", settingsPath,
  "--permission-mode", "default",
  "--allowedTools", "Read Edit Write Bash Glob Grep",
], { cwd: dir, stdio: "inherit" });

// auto-revoke: expire the scope so any later/lingering call is denied
try {
  const s = JSON.parse(fs.readFileSync(scopePath, "utf8"));
  s.expires_at = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(scopePath, JSON.stringify(s, null, 2));
} catch {}
console.log("\n  scope auto-revoked (run complete).");

// render the audit log
spawnSync(process.execPath, [path.join(repo, "src", "render-log.mjs"), logPath, dir], { stdio: "inherit" });
process.exit(res.status ?? 0);
