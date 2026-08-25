#!/usr/bin/env node
/**
 * install.mjs — deterministic personal-skills-and-agents installer for harness-kit.
 *
 * Copies every skill folder under plugin/skills/, plus the global agents under
 * plugin/agents/, into the user's personal folders so they work from any repository,
 * for both GitHub Copilot and Claude Code, without needing this repo open or an agent
 * to perform the copy.
 *
 * Usage:
 *   node plugin/scripts/install.mjs [options]
 *
 * Options:
 *   --copilot-only        Only install into the Copilot personal folders.
 *   --claude-only         Only install into the Claude personal folders.
 *   --yes                 Auto-confirm overwrites instead of prompting (non-interactive).
 *   --dry-run             Report planned actions without writing anything.
 *   --target-home <path>  Use <path> instead of the real home dir (testing only) — items
 *                         are written under <path>/.copilot and <path>/.claude.
 *   -h, --help             Show usage and exit.
 *
 * Targets:
 *   Copilot skills   plugin/skills/<name>/            -> ~/.copilot/skills/<name>/
 *   Claude skills    plugin/skills/<name>/             -> ~/.claude/skills/<name>/
 *                    plugin/agents/claude/skills/<name>/ -> ~/.claude/skills/<name>/
 *   Copilot agents   plugin/agents/<Name>.agent.md     -> ~/.copilot/agents/<Name>.agent.md
 *   Claude subagents plugin/agents/claude/agents/<n>.md -> ~/.claude/agents/<n>.md
 *
 * Exit code is 0 on success, 1 if the skills source directory can't be found or a
 * personal folder can't be written to (e.g. permission denied).
 *
 * No dependencies — only node:fs, node:path, node:readline (matches the style of
 * plugin/skills/harness-kit/scripts/check-brain-freshness.mjs).
 */

import { existsSync, readdirSync, statSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_SOURCE = join(__dirname, '..', 'skills');
const AGENTS_SOURCE = join(__dirname, '..', 'agents');
const CLAUDE_AGENT_SKILLS_SOURCE = join(AGENTS_SOURCE, 'claude', 'skills');
const CLAUDE_SUBAGENTS_SOURCE = join(AGENTS_SOURCE, 'claude', 'agents');
const VERSION_MARKER = '.harness-kit-version';

// Reads the kit version from the plugin manifest so the installer can stamp installs and
// report staleness. Returns 'unknown' if the manifest can't be read.
function readKitVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function readInstalledVersion(targetRoot) {
  const markerPath = join(targetRoot, VERSION_MARKER);
  if (!existsSync(markerPath)) return null;
  try {
    return readFileSync(markerPath, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function writeInstalledVersion(targetRoot, version) {
  mkdirSync(targetRoot, { recursive: true });
  writeFileSync(join(targetRoot, VERSION_MARKER), `${version}\n`, 'utf8');
}

function parseArgs(argv) {
  const args = {
    copilotOnly: false,
    claudeOnly: false,
    yes: false,
    dryRun: false,
    targetHome: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--copilot-only') args.copilotOnly = true;
    else if (argv[i] === '--claude-only') args.claudeOnly = true;
    else if (argv[i] === '--yes') args.yes = true;
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--target-home') args.targetHome = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node plugin/scripts/install.mjs [options]

Copies every skill folder under plugin/skills/, plus the global agents under
plugin/agents/, into your personal folders (~/.copilot and ~/.claude) so they work
from any repo, for both GitHub Copilot and Claude Code. Safe to re-run after a git pull.

Options:
  --copilot-only        Only install into the Copilot personal folders.
  --claude-only         Only install into the Claude personal folders.
  --yes                 Auto-confirm overwrites instead of prompting (non-interactive).
  --dry-run             Report planned actions without writing anything.
  --target-home <path>  Use <path> instead of the real home dir (testing only).
  -h, --help            Show this help and exit.

Examples:
  node plugin/scripts/install.mjs --dry-run
  node plugin/scripts/install.mjs --yes
`);
}

function isPermissionError(err) {
  return Boolean(err) && (err.code === 'EACCES' || err.code === 'EPERM');
}

function listSkillFolders(sourceDir) {
  if (!existsSync(sourceDir)) return [];
  return readdirSync(sourceDir).filter((name) => statSync(join(sourceDir, name)).isDirectory());
}

// Lists flat files directly under sourceDir (non-recursive) — used for single-file agent
// artifacts (Copilot *.agent.md, Claude subagent *.md), as opposed to folder-based skills.
function listFlatFiles(sourceDir) {
  if (!existsSync(sourceDir)) return [];
  return readdirSync(sourceDir).filter((name) => statSync(join(sourceDir, name)).isFile());
}

// Recursively list files in a directory, returning paths relative to that directory.
function listFilesRecursive(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out;
}

// Compares two skill-folder trees; returns { identical: bool, diffs: string[] } where
// diffs are human-readable one-liners describing what differs.
function diffFolders(sourceDir, targetDir) {
  const sourceFiles = listFilesRecursive(sourceDir).sort();
  const targetFiles = listFilesRecursive(targetDir).sort();
  const diffs = [];

  for (const file of sourceFiles) {
    const targetPath = join(targetDir, file);
    if (!existsSync(targetPath)) {
      diffs.push(`+ ${file} (missing in target)`);
      continue;
    }
    const sourceContent = readFileSync(join(sourceDir, file), 'utf8');
    const targetContent = readFileSync(targetPath, 'utf8');
    if (sourceContent !== targetContent) diffs.push(`~ ${file} (content differs)`);
  }
  for (const file of targetFiles) {
    if (!sourceFiles.includes(file)) diffs.push(`- ${file} (extra file in target, kept as-is)`);
  }

  return { identical: diffs.length === 0, diffs };
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function installSkillIntoTarget(skillName, sourceDir, targetRoot, { yes, dryRun }) {
  const targetDir = join(targetRoot, skillName);

  if (!existsSync(targetDir)) {
    if (!dryRun) {
      mkdirSync(dirname(targetDir), { recursive: true });
      cpSync(sourceDir, targetDir, { recursive: true });
    }
    return 'installed';
  }

  const { identical, diffs } = diffFolders(sourceDir, targetDir);
  if (identical) return 'up to date';

  console.log(`\n"${skillName}" differs at ${targetDir}:`);
  for (const line of diffs) console.log(`  ${line}`);

  const proceed = yes || dryRun ? true : await confirm(`Overwrite ${skillName} at ${targetDir}?`);
  if (!proceed) return 'left as-is';

  if (!dryRun) cpSync(sourceDir, targetDir, { recursive: true });
  return dryRun ? 'would update' : 'updated';
}

// Same idempotent install/diff/confirm behavior as installSkillIntoTarget, but for a
// single flat file (a Copilot *.agent.md or a Claude subagent *.md), not a skill folder.
async function installFileIntoTarget(fileName, sourceFile, targetRoot, { yes, dryRun }) {
  const targetFile = join(targetRoot, fileName);

  if (!existsSync(targetFile)) {
    if (!dryRun) {
      mkdirSync(targetRoot, { recursive: true });
      cpSync(sourceFile, targetFile);
    }
    return 'installed';
  }

  const identical = readFileSync(sourceFile, 'utf8') === readFileSync(targetFile, 'utf8');
  if (identical) return 'up to date';

  console.log(`\n"${fileName}" differs at ${targetFile} (content differs)`);

  const proceed = yes || dryRun ? true : await confirm(`Overwrite ${fileName} at ${targetFile}?`);
  if (!proceed) return 'left as-is';

  if (!dryRun) cpSync(sourceFile, targetFile);
  return dryRun ? 'would update' : 'updated';
}

function reportPermissionErrorAndExit(err, targetRoot) {
  if (!isPermissionError(err)) throw err;
  console.error(`\nPermission denied writing to ${targetRoot}.`);
  console.error('Check that you have write access to your home folder, or re-run with');
  console.error('--target-home <path> to install somewhere you control.');
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!existsSync(SKILLS_SOURCE)) {
    console.error(`Could not find skills source directory: ${SKILLS_SOURCE}`);
    process.exit(1);
  }

  const home = args.targetHome ?? homedir();
  const copilotSkillsRoot = join(home, '.copilot', 'skills');
  const claudeSkillsRoot = join(home, '.claude', 'skills');
  const copilotAgentsRoot = join(home, '.copilot', 'agents');
  const claudeAgentsRoot = join(home, '.claude', 'agents');

  const versionRoots = [];
  if (!args.claudeOnly) {
    versionRoots.push({ label: 'Copilot skills', root: copilotSkillsRoot });
    versionRoots.push({ label: 'Copilot agents', root: copilotAgentsRoot });
  }
  if (!args.copilotOnly) {
    versionRoots.push({ label: 'Claude skills', root: claudeSkillsRoot });
    versionRoots.push({ label: 'Claude agents', root: claudeAgentsRoot });
  }

  const skillNames = listSkillFolders(SKILLS_SOURCE);
  const copilotAgentFiles = listFlatFiles(AGENTS_SOURCE).filter((name) => name.endsWith('.agent.md'));
  const claudeAgentSkillNames = listSkillFolders(CLAUDE_AGENT_SKILLS_SOURCE);
  const claudeSubagentFiles = listFlatFiles(CLAUDE_SUBAGENTS_SOURCE);

  if (skillNames.length === 0) {
    console.error(`No skill folders found under ${SKILLS_SOURCE}`);
    process.exit(1);
  }

  const version = readKitVersion();
  console.log(`harness-kit ${version}${args.dryRun ? '  (dry run)' : ''}`);
  for (const target of versionRoots) {
    const installed = readInstalledVersion(target.root);
    if (installed === version) console.log(`  ${target.label}: already at ${version}`);
    else if (installed) console.log(`  ${target.label}: currently ${installed} \u2192 ${version}`);
    else console.log(`  ${target.label}: fresh install (not yet stamped)`);
  }

  const agentCount = copilotAgentFiles.length + claudeAgentSkillNames.length + claudeSubagentFiles.length;
  console.log(`\nInstalling ${skillNames.length} skill(s) and ${agentCount} agent artifact(s)\n`);

  const rows = [];

  const runFolderJob = async (name, sourceDir, targetRoot, targetLabel) => {
    try {
      const action = await installSkillIntoTarget(name, sourceDir, targetRoot, args);
      rows.push({ name, target: targetLabel, action });
    } catch (err) {
      reportPermissionErrorAndExit(err, targetRoot);
    }
  };

  const runFileJob = async (name, sourceFile, targetRoot, targetLabel) => {
    try {
      const action = await installFileIntoTarget(name, sourceFile, targetRoot, args);
      rows.push({ name, target: targetLabel, action });
    } catch (err) {
      reportPermissionErrorAndExit(err, targetRoot);
    }
  };

  // Cross-cutting skills -> both personal skills folders.
  for (const skillName of skillNames) {
    const sourceDir = join(SKILLS_SOURCE, skillName);
    if (!args.claudeOnly) await runFolderJob(skillName, sourceDir, copilotSkillsRoot, 'Copilot skill');
    if (!args.copilotOnly) await runFolderJob(skillName, sourceDir, claudeSkillsRoot, 'Claude skill');
  }

  // Global agents, Copilot side -> rich .agent.md custom-agent format.
  if (!args.claudeOnly) {
    for (const fileName of copilotAgentFiles) {
      await runFileJob(fileName, join(AGENTS_SOURCE, fileName), copilotAgentsRoot, 'Copilot agent');
    }
  }

  // Global agents, Claude side -> slash-invocable skill entry points, plus any real
  // subagent definitions they fork into (e.g. reviewer's read-only subagent).
  if (!args.copilotOnly) {
    for (const skillName of claudeAgentSkillNames) {
      await runFolderJob(skillName, join(CLAUDE_AGENT_SKILLS_SOURCE, skillName), claudeSkillsRoot, 'Claude skill');
    }
    for (const fileName of claudeSubagentFiles) {
      await runFileJob(fileName, join(CLAUDE_SUBAGENTS_SOURCE, fileName), claudeAgentsRoot, 'Claude subagent');
    }
  }

  console.log('\nName                      | Target           | Action');
  console.log('--------------------------|------------------|-------------');
  for (const row of rows) {
    console.log(`${row.name.padEnd(26)}| ${row.target.padEnd(17)}| ${row.action}`);
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.action] = (acc[row.action] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts).map(([action, count]) => `${count} ${action}`).join(', ');
  console.log(`\n${summary}`);

  if (!args.dryRun) {
    for (const target of versionRoots) writeInstalledVersion(target.root, version);
    console.log('\nDone. Re-run this script after a `git pull` to pick up kit updates.');
  }
}

main();
