#!/usr/bin/env node
/**
 * Temporarily move aside dev env files so Vite uses only .env.production (and .env.production.local if present).
 * Restores them after the command finishes (success or failure).
 *
 * Usage: node scripts/with-production-env-only.js -- <command> [args...]
 * Example: node scripts/with-production-env-only.js -- npm run build
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const STRIP_NAMES = ['.env', '.env.local', '.env.development'];
const SUFFIX = '.__publish_tmp';

function strip() {
  const moved = [];
  for (const name of STRIP_NAMES) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) {
      const bak = p + SUFFIX;
      fs.renameSync(p, bak);
      moved.push([p, bak]);
    }
  }
  return moved;
}

function restore(moved) {
  for (const [p, bak] of moved) {
    try {
      if (fs.existsSync(bak)) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
        fs.renameSync(bak, p);
      }
    } catch {
      /* ignore */
    }
  }
}

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep === -1 || sep === argv.length - 1) {
  console.error('Usage: node scripts/with-production-env-only.js -- <command> [args...]');
  console.error('Example: node scripts/with-production-env-only.js -- npm run build');
  process.exit(1);
}

const parts = argv.slice(sep + 1);
if (parts.length === 0) {
  console.error('Missing command after --');
  process.exit(1);
}

const cmd = parts[0];
const cmdArgs = parts.slice(1);

const moved = strip();
const env = { ...process.env, NODE_ENV: 'production' };

try {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: root,
    stdio: 'inherit',
    env,
    shell: true,
  });
  process.exit(r.status !== null && r.status !== undefined ? r.status : 1);
} finally {
  restore(moved);
}
