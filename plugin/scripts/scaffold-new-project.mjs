#!/usr/bin/env node
/**
 * scaffold-new-project.mjs — one-command bootstrap for a brand-new repo using harness-kit's
 * opinionated blueprint (Sections 01-03): folder skeleton, AGENTS.md/CLAUDE.md/Copilot
 * instructions, path-scoped instruction files, the agent roster, and the CI/security
 * workflows.
 *
 * Deliberately does NOT copy skills into the repo. Skills (domain playbooks + validation
 * audits) come from your global personal-skills install
 * (`node plugin/scripts/install.mjs`, run once on your machine) so every repo shares one
 * up-to-date copy instead of N per-repo copies that silently drift on the next kit
 * update. This script lists which global skills are relevant to the chosen shape in
 * docs/ai-infrastructure.md.
 *
 * This automates every *mechanical* step from the README's "Adopt the full blueprint"
 * checklist. It also does NOT: generate working application code (npm init, framework
 * boilerplate — use your normal scaffolding tool for that), or write
 * docs/project-context.md (that's an interview, not a copy — run `/harness-kit init` next).
 *
 * Run this from inside a clone of agentic-project-kit (it reads its own source folders):
 *
 *   node plugin/scripts/scaffold-new-project.mjs --shape minimal|frontend|fullstack --name <project-name> --target <path>
 *
 * Options:
 *   --shape <minimal|frontend|fullstack>
                                Which skeleton to scaffold. Required.
 *   --name <project-name>         Used to fill {{PROJECT_NAME}}/{{PROJECT}} placeholders. Required.
 *   --target <path>               Destination repo (created if missing). Required.
 *   --yes                         Auto-confirm writing into a non-empty target.
 *   --dry-run                     Report planned actions without writing anything.
 *   -h, --help                    Show usage and exit.
 *
 * No dependencies — only node:fs, node:path, node:readline (matches install.mjs).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  cpSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = join(__dirname, '..', '..');

// Deliberately stack-neutral. These lay out the *harness*, not an application — pick
// your own frameworks and generate app code with their own CLIs afterwards.
const SHAPES = {
  minimal: {
    label: 'Minimal (harness only — bring your own stack)',
    skeletonDirs: ['docs', 'src', 'tests'],
    excludeInstructions: [],
    relevantSkills: ['systematic-debugging'],
  },
  frontend: {
    label: 'Frontend-only',
    skeletonDirs: ['docs', 'src/app', 'src/components', 'src/lib', 'tests', 'public'],
    excludeInstructions: [],
    relevantSkills: ['systematic-debugging'],
  },
  fullstack: {
    label: 'Full-stack (frontend + backend + datastore)',
    skeletonDirs: [
      'docs',
      'apps/api/src',
      'apps/web/src',
      'packages/shared',
      'infrastructure',
      'tests',
    ],
    excludeInstructions: [],
    relevantSkills: ['systematic-debugging'],
  },
};

// Always relevant regardless of shape — ships in the global personal install too.
const ALWAYS_RELEVANT_SKILLS = ['harness-kit'];

function printHelp() {
  console.log(`Usage: node plugin/scripts/scaffold-new-project.mjs --shape <minimal|frontend|fullstack> --name <project-name> --target <path> [options]

Options:
  --shape <minimal|frontend|fullstack>
                                Which skeleton to scaffold. Required.
  --name <project-name>         Fills {{PROJECT_NAME}}/{{PROJECT}} placeholders. Required.
  --target <path>               Destination repo (created if missing). Required.
  --yes                         Auto-confirm writing into a non-empty target.
  --dry-run                     Report planned actions without writing anything.
  -h, --help                    Show this help and exit.

Run this from inside a clone of harness-kit. Next steps after scaffolding are printed at
the end (fill remaining placeholders, run /harness-kit init).`);
}

function parseArgs(argv) {
  const args = { shape: null, name: null, target: null, yes: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--shape') args.shape = argv[++i];
    else if (argv[i] === '--name') args.name = argv[++i];
    else if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--yes') args.yes = true;
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '-h' || argv[i] === '--help') args.help = true;
  }
  return args;
}

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(`${question} (y/N) `, (answer) => {
    rl.close();
    res(/^y(es)?$/i.test(answer.trim()));
  }));
}

function slug(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Best-effort detection of {org, repo} from the target's git remote, if it's already a
// git repo with an `origin` configured (e.g. created via `gh repo create` then cloned).
// Returns null fields when it can't tell — never guesses.
function detectOrgRepo(target) {
  try {
    const url = execFileSync('git', ['-C', target, 'remote', 'get-url', 'origin'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const match = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return { org: match[1], repo: match[2] };
  } catch {
    // Not a git repo yet, or no `origin` remote — that's fine, leave as a placeholder.
  }
  return { org: null, repo: null };
}

function isTextFile(path) {
  return /\.(md|yml|yaml|mjs|ts|tsx|js|json)$/i.test(path);
}

// Copies a file or directory tree, substituting {{PROJECT_NAME}} / {{PROJECT}} in text
// files as it goes. Returns the list of relative-to-target paths written, and a list of
// paths that still contain other {{PLACEHOLDER}} tokens needing human input.
function copyWithSubstitution(source, target, tokens, opts, written, needsInput) {
  const { dryRun } = opts;
  const stat = statSync(source);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(source)) {
      copyWithSubstitution(join(source, entry), join(target, entry), tokens, opts, written, needsInput);
    }
    return;
  }
  if (!dryRun) mkdirSync(dirname(target), { recursive: true });
  if (isTextFile(source)) {
    let content = readFileSync(source, 'utf8');
    for (const [token, value] of Object.entries(tokens)) {
      if (value) content = content.replaceAll(`{{${token}}}`, value);
    }
    if (!dryRun) writeFileSync(target, content);
    if (/\{\{[A-Z_]+\}\}/.test(content)) needsInput.push(relative(process.cwd(), target));
  } else if (!dryRun) {
    cpSync(source, target);
  }
  written.push(relative(process.cwd(), target));
}

function copyDirFiltered(sourceDir, targetDir, excludeNames, tokens, opts, written, needsInput) {
  if (!existsSync(sourceDir)) return;
  for (const entry of readdirSync(sourceDir)) {
    if (excludeNames.includes(entry)) continue;
    copyWithSubstitution(join(sourceDir, entry), join(targetDir, entry), tokens, opts, written, needsInput);
  }
}

function writeAiInfrastructureDoc(target, shape, written, opts) {
  const relevantSkills = [...shape.relevantSkills, ...ALWAYS_RELEVANT_SKILLS].sort();
  const lines = [
    '# AI infrastructure inventory',
    '',
    `> Auto-generated by \`scaffold-new-project.mjs\` on ${new Date().toISOString().slice(0, 10)}.`,
    '> Keep this current when you add/remove an instruction file, skill, or agent — it is',
    '> what the Documentation (S4) readiness segment looks for.',
    '',
    `**Shape:** ${shape.label}`,
    '',
    '## Skills (provided globally, not copied into this repo)',
    '',
    'Skills live once in `~/.copilot/skills/` and `~/.claude/skills/` — run',
    '`node <agentic-project-kit>/plugin/scripts/install.mjs` on this machine if you haven\'t',
    'yet. They are intentionally not duplicated per repo, so every repo shares one',
    'up-to-date copy instead of drifting on the next kit update. Relevant to this repo:',
    '',
    ...relevantSkills.map((s) => `- \`${s}\``),
    '',
    '## What was scaffolded',
    '',
    ...written
      .filter((p) => !p.startsWith(join('docs', 'ai-infrastructure.md')))
      .sort()
      .map((p) => `- \`${p.split('\\').join('/')}\``),
    '',
  ];
  const target_ = join(target, 'docs', 'ai-infrastructure.md');
  if (!opts.dryRun) {
    mkdirSync(dirname(target_), { recursive: true });
    writeFileSync(target_, lines.join('\n'));
  }
  written.push(relative(process.cwd(), target_));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  if (!args.shape || !SHAPES[args.shape]) {
    console.error(`--shape must be one of: ${Object.keys(SHAPES).join(', ')}`);
    process.exit(1);
  }
  if (!args.name) {
    console.error('--name is required (used to fill {{PROJECT_NAME}}/{{PROJECT}} placeholders)');
    process.exit(1);
  }
  if (!args.target) {
    console.error('--target <path> is required (the destination repo)');
    process.exit(1);
  }

  const shape = SHAPES[args.shape];
  const target = args.target;
  const projectName = args.name;
  const projectSlug = slug(args.name);
  const { org, repo } = detectOrgRepo(target);
  const tokens = {
    PROJECT_NAME: projectName,
    PROJECT: projectSlug,
    ORG: org,
    REPO: repo || projectSlug,
    AGENTIC_LABEL: 'agentic',
  };

  if (existsSync(target) && readdirSync(target).length > 0) {
    const proceed = args.yes || args.dryRun ? true : await confirm(
      `${target} is not empty. Files may be overwritten. Continue?`
    );
    if (!proceed) {
      console.log('Aborted — nothing written.');
      return;
    }
  }

  console.log(`harness-kit scaffold — ${shape.label}${args.dryRun ? '  (dry run)' : ''}`);
  console.log(`  target: ${target}`);
  console.log(`  project name: ${projectName}  (slug: ${projectSlug})\n`);

  const written = [];
  const needsInput = [];
  const opts = { dryRun: args.dryRun };

  // 1. Skeleton directories (structure only — no application code).
  for (const dir of shape.skeletonDirs) {
    const full = join(target, dir);
    if (!opts.dryRun) {
      mkdirSync(full, { recursive: true });
      writeFileSync(join(full, '.gitkeep'), '');
    }
    written.push(relative(process.cwd(), join(full, '.gitkeep')));
  }

  // 2. Root agentic-layer files.
  copyWithSubstitution(
    join(KIT_ROOT, '02-agentic-preparation', 'templates', 'AGENTS.md'),
    join(target, 'AGENTS.md'),
    tokens, opts, written, needsInput
  );
  copyWithSubstitution(
    join(KIT_ROOT, '02-agentic-preparation', 'templates', 'CLAUDE.md'),
    join(target, 'CLAUDE.md'),
    tokens, opts, written, needsInput
  );
  copyWithSubstitution(
    join(KIT_ROOT, '02-agentic-preparation', 'templates', 'copilot-instructions.md'),
    join(target, '.github', 'copilot-instructions.md'),
    tokens, opts, written, needsInput
  );
  copyWithSubstitution(
    join(KIT_ROOT, '02-agentic-preparation', 'templates', 'story-template.md'),
    join(target, '.github', 'story-template.md'),
    tokens, opts, written, needsInput
  );

  // 3. Path-scoped instruction files (shape-filtered).
  copyDirFiltered(
    join(KIT_ROOT, '02-agentic-preparation', 'templates', 'instructions'),
    join(target, '.github', 'instructions'),
    shape.excludeInstructions,
    tokens, opts, written, needsInput
  );

  // 4. Agent roster + CI/security workflows. Skills are deliberately NOT copied here —
  // see writeAiInfrastructureDoc: they come from the global personal-skills install.
  copyDirFiltered(
    join(KIT_ROOT, '03-agent-setup', 'agents'),
    join(target, '.github', 'agents'),
    [],
    tokens, opts, written, needsInput
  );
  copyDirFiltered(
    join(KIT_ROOT, '03-agent-setup', 'workflows'),
    join(target, '.github', 'workflows'),
    [],
    tokens, opts, written, needsInput
  );

  // 5. Auto-generated inventory doc (docs/project-context.md is deliberately NOT created
  // here — that's an interview via `/harness-kit init`, not a mechanical copy).
  writeAiInfrastructureDoc(target, shape, written, opts);

  console.log(`${written.length} file(s) ${opts.dryRun ? 'would be ' : ''}written.\n`);

  if (needsInput.length > 0) {
    console.log('These files still have placeholders only you can fill in (e.g. {{UI_LIB}}, {{ONE_LINE_DESCRIPTION}}):');
    for (const f of [...new Set(needsInput)].sort()) console.log(`  - ${f}`);
    console.log('');
  }

  console.log('Next steps:');
  console.log('  1. Fill in the remaining placeholders listed above.');
  console.log('  2. Make sure skills are installed globally on this machine (once):');
  console.log('     node <harness-kit>/plugin/scripts/install.mjs');
  console.log('     (see docs/ai-infrastructure.md for the skills this repo actually uses —');
  console.log('     they are intentionally NOT copied into this repo, to avoid per-repo drift)');
  console.log('  3. Open the new repo in Copilot Chat / Claude Code and run: /harness-kit init');
  console.log('     (creates docs/project-context.md — the "brain" — via a short interview)');
  if (args.shape !== 'minimal') {
    console.log('  4. Scaffold the actual application code (npm init / framework CLI) into');
    console.log('     the skeleton folders just created — this script only lays out structure');
    console.log('     and the agentic layer, it does not generate working app code.');
  }
}

main();
