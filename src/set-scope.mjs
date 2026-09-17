#!/usr/bin/env node
/**
 * set-scope — the /scope command's grant channel.
 *   set-scope <roots> <ttl> [--network]
 *   set-scope src,tests 15m
 * Writes .scoped-agent.json (the durable policy) AND mints scope.json immediately
 * so the grant takes effect for the current session.
 */
import fs from "node:fs";
import path from "node:path";

function parseTtl(s) {
  if (!s) return 900;
  const m = String(s).match(/^(\d+)\s*(s|m|h)?$/i);
  if (!m) return 900;
  const n = parseInt(m[1], 10);
  return m[2] ? { s: n, m: n * 60, h: n * 3600 }[m[2].toLowerCase()] : n;
}

const args = process.argv.slice(2);
const allowNetwork = args.includes("--network");
const positional = args.filter((a) => !a.startsWith("--"));
const roots = (positional[0] || ".").split(",").map((s) => s.trim()).filter(Boolean);
const ttl = parseTtl(positional[1]);

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
fs.writeFileSync(path.join(projectDir, ".scoped-agent.json"), JSON.stringify({ roots, ttl_seconds: ttl, allow_network: allowNetwork }, null, 2) + "\n");
fs.writeFileSync(path.join(projectDir, "scope.json"), JSON.stringify({
  allowed_roots: roots, allow_network: allowNetwork, ttl_seconds: ttl,
  expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
}, null, 2));
try { fs.writeFileSync(path.join(projectDir, "access-log.jsonl"), ""); } catch {}

console.log(`scoped-agent: granted [${roots.join(", ")}] for ${ttl}s (network ${allowNetwork ? "on" : "off"}).`);
console.log(`policy written to .scoped-agent.json — re-minted automatically at each session start.`);
