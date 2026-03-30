#!/usr/bin/env node
/**
 * 1) Push current HEAD to a remote branch you choose (so GitHub has the latest code).
 * 2) Trigger the Windows publish workflow on that branch.
 *
 * Requires: gh CLI (gh auth login), git, and this repo to be a clone with origin set.
 */

const { execSync } = require('child_process');
const readline = require('readline');

const REPO = process.env.BUSIMAN_DESKTOP_REPO || 'Busiman-official/busiman-desktop';
const WORKFLOW_FILE = 'publish-windows.yml';

function checkGitHubCLI() {
  try {
    execSync('gh --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function execGit(args, opts = {}) {
  return execSync(`git ${args}`, { encoding: 'utf8', ...opts });
}

function getGitRoot() {
  try {
    return execGit('rev-parse --show-toplevel').trim();
  } catch {
    return null;
  }
}

function getCurrentBranch() {
  return execGit('rev-parse --abbrev-ref HEAD').trim();
}

function isWorkingTreeDirty() {
  try {
    execSync('git diff --quiet', { stdio: 'ignore' });
    execSync('git diff --cached --quiet', { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

function promptLine(question, defaultValue) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const hint = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${question}${hint}: `, (answer) => {
      rl.close();
      const v = (answer || '').trim();
      resolve(v || defaultValue || '');
    });
  });
}

async function main() {
  if (!checkGitHubCLI()) {
    console.error('❌ GitHub CLI (gh) is not installed.');
    console.error('   https://cli.github.com/  →  gh auth login');
    process.exit(1);
  }

  const root = getGitRoot();
  if (!root) {
    console.error('❌ Not a git repository (run this from the desktop project root).');
    process.exit(1);
  }

  const cwd = root;
  const runGit = (args) => execGit(args, { cwd });

  const current = getCurrentBranch();
  if (current === 'HEAD') {
    console.error('❌ Detached HEAD. Checkout a branch first, then run publish:win.');
    process.exit(1);
  }

  if (isWorkingTreeDirty()) {
    console.error('❌ You have uncommitted changes. Commit or stash them before publishing.');
    console.error('   (Only committed code can be pushed and built.)');
    process.exit(1);
  }

  const branch = await promptLine(
    '🌿 Remote branch to push your latest commits to (workflow will run on this ref)',
    current
  );

  if (!branch || branch.includes('..') || /\s/.test(branch)) {
    console.error('❌ Invalid branch name (no spaces or ..).');
    process.exit(1);
  }

  console.log('');
  console.log(`📤 Pushing HEAD → origin/${branch} ...`);

  try {
    execSync(`git push -u origin HEAD:refs/heads/${branch}`, {
      cwd,
      stdio: 'inherit',
    });
  } catch {
    console.error('❌ git push failed. Fix the error above (auth, remote, or permissions).');
    process.exit(1);
  }

  console.log('');
  console.log(`🚀 Triggering workflow ${WORKFLOW_FILE} on ref ${branch} ...`);

  try {
    execSync(`gh workflow run ${WORKFLOW_FILE} -R ${REPO} --ref ${branch}`, {
      stdio: 'inherit',
    });
  } catch (error) {
    const msg = error.message || String(error);
    if (msg.includes('404') || msg.includes('not found')) {
      console.error('❌ Workflow not found. Ensure .github/workflows/publish-windows.yml exists on', branch);
    } else {
      console.error('❌ Failed to trigger workflow:', msg);
    }
    process.exit(1);
  }

  console.log('');
  console.log('✅ Workflow triggered.');
  console.log(`📊 https://github.com/${REPO}/actions`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
