#!/usr/bin/env node
/**
 * scoped-agent — PreToolUse policy hook.
 *
 * This IS the permission decision for a scoped agent run. Claude Code invokes it
 * before every tool call, passing the call as JSON on stdin. We allow the call
 * only if it stays inside the granted scope (allowed roots) and the run's TTL has
 * not elapsed; everything else is denied. Every decision is appended to
 * access-log.jsonl so the run has a complete, auditable record.
 *
 * Design principles:
 *   - Fail closed. No scope file, malformed scope, or expired TTL => deny.
 *   - Scope the ARGUMENT, not just the tool. A permitted tool (Read) reaching a
 *     path outside scope is still denied — coarse allowlists can't do this.
 *   - Resolve + realpath before comparing, so `..` traversal and symlinks that
 *     escape the sandbox are caught.
 *
 * Zero dependencies (Node stdlib only).
 */
"use strict";
const fs = require("fs");
const path = require("path");

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

/** Resolve a path and, if it (or its nearest existing ancestor) is a symlink,
 * follow it — so a symlink inside the sandbox pointing outside is caught. */
function realResolve(projectDir, p) {
  const resolved = path.resolve(projectDir, p);
  let probe = resolved;
  // Walk up to the nearest existing ancestor and realpath that, then re-append.
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
  } catch {
    return resolved;
  }
}

function within(projectDir, roots, target) {
  if (!target) return false;
  const real = realResolve(projectDir, target);
  return roots.some((root) => {
    const base = realResolve(projectDir, root);
    return real === base || real.startsWith(base + path.sep);
  });
}

const NETWORK_RE = /(^|[\s;|&(])(curl|wget|nc|ncat|ssh|scp|sftp|telnet|ftp|rsync)(\s|$)/;
const HOME_OR_ABS_RE = /(^|[\s;|&(=])(~\/|\/(etc|var|usr|bin|sbin|opt|private|System|Library)\b|\/Users\/)/;
const TRAVERSAL_RE = /\.\.(\/|\\|\s|$)/;
const SECRET_RE = /(id_rsa|id_ed25519|\.ssh\b|\.aws\b|\.env\b|credentials|secret)/i;

function decide(input, scope) {
  const now = Date.now();
  if (!scope) return ["deny", "no active scope — fail closed"];
  if (!scope.expires_at) return ["deny", "scope not minted (no expires_at) — fail closed"];
  if (now > Date.parse(scope.expires_at)) return ["deny", "scope expired (TTL elapsed) — access auto-revoked"];

  const projectDir = input.cwd || process.cwd();
  const roots = Array.isArray(scope.allowed_roots) && scope.allowed_roots.length ? scope.allowed_roots : ["sandbox"];
  const tool = input.tool_name || "";
  const ti = input.tool_input || {};

  if (Array.isArray(scope.allowed_tools) && !scope.allowed_tools.includes(tool)) {
    return ["deny", `tool ${tool} not in granted scope`];
  }

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

  // Read-only discovery tools with no path arg (TodoWrite, etc.) pass through.
  return ["allow", "in scope"];
}

// --- main -----------------------------------------------------------------
const input = (() => { try { return JSON.parse(readStdin() || "{}"); } catch { return {}; } })();
const projectDir = input.cwd || process.cwd();
const scope = loadJson(path.join(projectDir, "scope.json"));
const [decision, reason] = decide(input, scope);

try {
  fs.appendFileSync(
    path.join(projectDir, "access-log.jsonl"),
    JSON.stringify({
      ts: new Date().toISOString(),
      tool: input.tool_name || "",
      target: (input.tool_input && (input.tool_input.file_path || input.tool_input.command)) || "",
      decision,
      reason,
    }) + "\n"
  );
} catch { /* logging must never crash the hook */ }

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: decision,
    permissionDecisionReason: reason,
  },
}));
process.exit(0);
