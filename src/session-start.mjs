#!/usr/bin/env node
/**
 * SessionStart hook — auto-mint a fresh grant from the project's policy file.
 * If .scoped-agent.json exists, write scope.json with expires_at = now + ttl and
 * start a clean access log. If it doesn't exist, do nothing (plugin stays inert).
 * The agent never runs this; Claude Code fires it at session start.
 */
import fs from "node:fs";
import path from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const policyPath = path.join(projectDir, ".scoped-agent.json");
if (!fs.existsSync(policyPath)) process.exit(0);

let policy = {};
try { policy = JSON.parse(fs.readFileSync(policyPath, "utf8")); } catch { process.exit(0); }

const roots = Array.isArray(policy.roots) && policy.roots.length ? policy.roots : ["."];
const ttl = Number.isFinite(policy.ttl_seconds) ? policy.ttl_seconds : 900;
const allowNetwork = !!policy.allow_network;

fs.writeFileSync(path.join(projectDir, "scope.json"), JSON.stringify({
  allowed_roots: roots, allow_network: allowNetwork, ttl_seconds: ttl,
  expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
}, null, 2));
try { fs.writeFileSync(path.join(projectDir, "access-log.jsonl"), ""); } catch {}

process.stdout.write(`scoped-agent: granted [${roots.join(", ")}] for ${ttl}s (network ${allowNetwork ? "on" : "off"}). every tool call is checked and logged.`);
process.exit(0);
