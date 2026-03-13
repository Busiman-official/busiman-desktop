#!/usr/bin/env node
/**
 * Trigger GitHub Actions workflow to publish Windows installer
 * This script uses GitHub CLI to trigger the workflow without requiring local credentials
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Check if GitHub CLI is installed
function checkGitHubCLI() {
  try {
    execSync('gh --version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Trigger the workflow
function triggerWorkflow() {
  try {
    console.log('🚀 Triggering GitHub Actions workflow to publish Windows installer...');
    // Run the workflow against the remote repo directly, so we don't need a local .git repo
    execSync('gh workflow run publish-windows.yml -R Busiman-official/busiman-desktop', {
      stdio: 'inherit',
    });
    console.log('✅ Workflow triggered successfully!');
    console.log('📊 Check the workflow status at: https://github.com/Busiman-official/busiman-desktop/actions');
  } catch (error) {
    const errorMessage = error.message || error.toString();
    
    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      console.error('❌ Workflow file not found on GitHub repository.');
      console.error('');
      console.error('📝 The workflow file needs to be committed and pushed to the repository first.');
      console.error('');
      console.error('To fix this:');
      console.error('1. Commit the workflow file:');
      console.error('   git add .github/workflows/publish-windows.yml');
      console.error('   git commit -m "Add Windows installer publish workflow"');
      console.error('2. Push to GitHub:');
      console.error('   git push origin main  # or your default branch');
      console.error('3. Then run this command again: npm run publish:win');
    } else {
      console.error('❌ Failed to trigger workflow:', errorMessage);
    }
    process.exit(1);
  }
}

// Main execution
if (!checkGitHubCLI()) {
  console.error('❌ GitHub CLI (gh) is not installed.');
  console.error('📦 Install it from: https://cli.github.com/');
  console.error('🔐 Then authenticate with: gh auth login');
  process.exit(1);
}

triggerWorkflow();