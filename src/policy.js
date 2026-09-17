#!/usr/bin/env node
/**
 * scoped-agent — PreToolUse policy hook (shared by the CLI wrapper and the plugin).
 *
 * Claude Code invokes this before every tool call, passing the call as JSON on
 * stdin. We allow the call only if it stays inside the granted scope (allowed
 * roots) and the run's TTL has not elapsed; everything else is denied. Every
 * decision is appended to access-log.jsonl.
 *
 * Modes:
 *   - INERT: no scope.json and no .scoped-agent.json in the project => emit
 *     nothing and defer to Claude Code's normal permission flow. Installing the
 *     plugin does nothing until you opt a project in.
 *   - ENFORCING: scope.json present => allow in-scope, deny out-of-scope.
 *   - FAIL-CLOSED: a policy file exists but no live grant => deny everything.
 *
 * Invariants:
 *   - The agent cannot edit its own leash: writes to scope.json / .scoped-agent.json
 *     / access-log.jsonl are always denied.
 *   - Scope the ARGUMENT, not just the tool; realpath so `..` and symlink escapes
 *     are caught.
 *
 * Zero dependencies (Node stdlib only).
 */
"use strict";
const fs = require("fs");
const path = require("path");

function readStdin() { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }
function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }

const PROTECTED = new Set(["scope.json", ".scoped-agent.json", "access-log.jsonl"]);
const NETWORK_RE = /(^|[\s;|&(])(curl|wget|nc|ncat|ssh|scp|sftp|telnet|ftp|rsync)(\s|$)/;
const HOME_OR_ABS_RE = /(^|[\s;|&(=])(~\/|\/(etc|var|usr|bin|sbin|opt|private|System|Library)\b|\/Users\/)/;
const TRAVERSAL_RE = /\.\.(\/|\\|\s|$)/;
const SECRET_RE = /(id_rsa|id_ed25519|\.ssh\b|\.aws\b|\.env\b|credentials|secret)/i;
const SANCTIONED_RE = /set-scope\.mjs/; // the plugin's own grant channel (/scope)

function realResolve(projectDir, p) {
  const resolved = path.resolve(projectDir, p);
  let probe = resolved;
  const tail = [];
  while (!fs.existsSync(probe)) {
    tail.unshift(path.basename(probe));
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  try {
    const real = fs.realpathSync(probe);
    return tail.length ? path.join(real, ...tail) : real;
  } catch { return resolved; }
}

function within(projectDir, roots, target) {
  if (!target) return false;
  const real = realResolve(projectDir, target);
  return roots.some((root) => {
    const base = realResolve(projectDir, root);
    return real === base || real.startsWith(base + path.sep);
  });
}

function decide(input, projectDir, scope) {
  const tool = input.tool_name || "";
  const ti = input.tool_input || {};

  // Invariant: never let the agent rewrite its own leash.
  if (["Write", "Edit", "NotebookEdit"].includes(tool)) {
    const fp = ti.file_path || ti.notebook_path || "";
    if (PROTECTED.has(path.basename(fp || ""))) return ["deny", "cannot modify its own scope, policy, or audit log"];
  }
  // Sanctioned grant channel: the /scope command runs the bundled set-scope script.
  if (tool === "Bash" && SANCTIONED_RE.test(String(ti.command || ""))) return ["allow", "scope management (operator grant channel)"];

  const now = Date.now();
  if (!scope.expires_at) return ["deny", "scope not minted — fail closed"];
  if (now > Date.parse(scope.expires_at)) return ["deny", "scope expired (TTL elapsed) — access auto-revoked"];

  const roots = Array.isArray(scope.allowed_roots) && scope.allowed_roots.length ? scope.allowed_roots : ["."];
  if (Array.isArray(scope.allowed_tools) && !scope.allowed_tools.includes(tool)) return ["deny", `tool ${tool} not in granted scope`];

  if (["Read", "Edit", "Write", "NotebookEdit"].includes(tool)) {
    const fp = ti.file_path || ti.notebook_path || "";
    if (!within(projectDir, roots, fp)) return ["deny", `out of scope: ${fp} is outside [${roots.join(", ")}]`];
    return ["allow", "in scope"];
  }
  if (tool === "Bash") {
    const cmd = String(ti.command || "");
    if (!scope.allow_network && NETWORK_RE.test(cmd)) return ["deny", "out of scope: network access not granted"];
    if (SECRET_RE.test(cmd)) return ["deny", "out of scope: command references a secret path"];
    if (TRAVERSAL_RE.test(cmd) || HOME_OR_ABS_RE.test(cmd)) return ["deny", "out of scope: command reaches outside the sandbox"];
    return ["allow", "in scope"];
  }
  return ["allow", "in scope"];
}

// --- main -----------------------------------------------------------------
const input = (() => { try { return JSON.parse(readStdin() || "{}"); } catch { return {}; } })();
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const scope = loadJson(path.join(projectDir, "scope.json"));
const policyExists = fs.existsSync(path.join(projectDir, ".scoped-agent.json"));

// INERT: not opted in anywhere => stay silent, let Claude Code decide.
if (!scope && !policyExists) process.exit(0);

let decision, reason;
if (!scope) { [decision, reason] = ["deny", "policy present but no live grant — fail closed"]; }
else { [decision, reason] = decide(input, projectDir, scope); }

try {
  fs.appendFileSync(path.join(projectDir, "access-log.jsonl"), JSON.stringify({
    ts: new Date().toISOString(),
    tool: input.tool_name || "",
    target: (input.tool_input && (input.tool_input.file_path || input.tool_input.command)) || "",
    decision, reason,
  }) + "\n");
} catch { /* logging must never crash the hook */ }

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
}));
process.exit(0);
