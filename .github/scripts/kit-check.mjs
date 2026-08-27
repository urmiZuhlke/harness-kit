#!/usr/bin/env node
/**
 * kit-check.mjs — self-check for harness-kit's own repo hygiene.
 *
 * Runs a handful of cheap, dependency-free checks that catch the class of bug the kit
 * ships to consumers to avoid, applied to itself:
 *   1. Every SKILL.md has YAML frontmatter with a `name` and a `description`.
 *   2. plugin/.claude-plugin/plugin.json and .claude-plugin/marketplace.json are valid
 *      JSON and their `version` fields match.
 *   3. The canonical agent roster and its bundled (plugin/agents/)
 *      copies don't silently drift — differences are allowed only in relative link paths
 *      and cosmetic table-alignment, never in content.
 *
 * Usage: node .github/scripts/kit-check.mjs
 * Exit code 0 if all checks pass, 1 otherwise (prints every failure found, doesn't stop
 * at the first one).
 *
 * No dependencies — only node:fs, node:path (matches the style of plugin/scripts/install.mjs).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIMENSIONS } from '../../lib/score/dimensions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let failures = [];

function fail(message) {
  failures.push(message);
}

function findFiles(dir, name, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findFiles(full, name, out);
    else if (entry.name === name) out.push(full);
  }
  return out;
}

// --- Check 1: every SKILL.md has valid frontmatter with name + description ---
function checkSkillFrontmatter() {
  const skillFiles = findFiles(ROOT, 'SKILL.md');
  if (skillFiles.length === 0) {
    fail('No SKILL.md files found at all — that looks wrong for this repo.');
    return;
  }
  for (const file of skillFiles) {
    const content = readFileSync(file, 'utf8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const rel = file.replace(ROOT, '').replace(/^[\\/]/, '');
    if (!match) {
      fail(`${rel}: missing YAML frontmatter (expected a leading --- ... --- block)`);
      continue;
    }
    const frontmatter = match[1];
    if (!/^name:\s*\S+/m.test(frontmatter)) fail(`${rel}: frontmatter missing "name"`);
    if (!/^description:\s*\S+/m.test(frontmatter)) fail(`${rel}: frontmatter missing "description"`);
  }
  console.log(`Checked frontmatter on ${skillFiles.length} SKILL.md file(s).`);
}

// --- Check 2: manifests are valid JSON and versions match ---
function checkManifestVersions() {
  const pluginPath = join(ROOT, 'plugin', '.claude-plugin', 'plugin.json');
  const marketplacePath = join(ROOT, '.claude-plugin', 'marketplace.json');
  let plugin, marketplace;
  try {
    plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
  } catch (e) {
    fail(`plugin/.claude-plugin/plugin.json: invalid JSON (${e.message})`);
    return;
  }
  try {
    marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
  } catch (e) {
    fail(`.claude-plugin/marketplace.json: invalid JSON (${e.message})`);
    return;
  }
  const pluginVersion = plugin.version;
  const marketplaceVersion = marketplace.plugins?.[0]?.version;
  if (!pluginVersion) fail('plugin/.claude-plugin/plugin.json: missing "version"');
  if (!marketplaceVersion) fail('.claude-plugin/marketplace.json: missing plugins[0].version');
  if (pluginVersion && marketplaceVersion && pluginVersion !== marketplaceVersion) {
    fail(`Version mismatch: plugin.json is ${pluginVersion}, marketplace.json is ${marketplaceVersion}`);
  } else if (pluginVersion) {
    console.log(`Manifest versions match: ${pluginVersion}`);
  }
}

// --- Check 3: canonical vs. bundled agent roster must not silently drift ---
// plugin/agents/ mirrors 03-agent-setup/agents/. The copies are intentionally not
// byte-identical: relative link depths differ. Strip that expected difference, then
// compare — anything left over is real drift.
function normalizeForDrift(content) {
  const lines = content.replace(/\]\([^)]*\)/g, ']').split('\n');
  const kept = [];
  let skippingNote = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^>\s*This is a copy of/.test(trimmed)) {
      skippingNote = true;
      continue;
    }
    if (skippingNote) {
      if (trimmed.startsWith('>')) continue; // still inside the note blockquote
      skippingNote = false; // blockquote ended, fall through to keep this line
    }
    kept.push(line);
  }
  return kept
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '' && line !== '>') // ignore blank/blank-blockquote-line differences
    .filter((line) => !/^\|[\s-]*\|/.test(line)) // ignore table-separator rows (alignment-only)
    .join('\n');
}

function checkCanonicalBundledParity() {
  const agentFiles = ['Planner.agent.md', 'Implementer.agent.md', 'Reviewer.agent.md', 'Explore.agent.md'];
  const pairs = agentFiles.map((name) => [
    join(ROOT, '03-agent-setup', 'agents', name),
    join(ROOT, 'plugin', 'agents', name),
  ]);
  for (const [canonical, bundled] of pairs) {
    const a = normalizeForDrift(readFileSync(canonical, 'utf8'));
    const b = normalizeForDrift(readFileSync(bundled, 'utf8'));
    if (a !== b) {
      fail(
        `Canonical/bundled drift: ${canonical.replace(ROOT, '')} and ${bundled.replace(ROOT, '')} ` +
          'differ beyond link paths/table alignment — reconcile them.'
      );
    } else {
      console.log(`Parity OK: ${canonical.replace(ROOT, '')} <-> ${bundled.replace(ROOT, '')}`);
    }
  }
}

/**
 * The rubric weights are stated in docs/rubric.md and implemented in the scorer, and
 * AGENTS.md requires them to move together. Nothing enforced that, so a change to one
 * could silently make the published rubric a lie. They must agree, and sum to 100.
 */
function checkRubricWeights() {
  const rubricPath = join(ROOT, 'docs', 'rubric.md');
  const dimensionsPath = join(ROOT, 'lib', 'score', 'dimensions.mjs');
  if (!existsSync(rubricPath) || !existsSync(dimensionsPath)) {
    fail('Cannot check rubric weights: docs/rubric.md or lib/score/dimensions.mjs is missing');
    return;
  }

  const rubricWeights = [...readFileSync(rubricPath, 'utf8')
    .matchAll(/^\|\s*\d+\s*\|[^|]+\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
  const scorerWeights = [...readFileSync(dimensionsPath, 'utf8')
    .matchAll(/^ {4}points: (\d+),$/gm)].map((m) => Number(m[1]));

  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  if (!rubricWeights.length) {
    fail('docs/rubric.md: no dimension weights found — has the table format changed?');
    return;
  }
  if (sum(rubricWeights) !== 100) {
    fail(`docs/rubric.md weights sum to ${sum(rubricWeights)}, not 100`);
  }
  if (sum(scorerWeights) !== 100) {
    fail(`lib/score/dimensions.mjs weights sum to ${sum(scorerWeights)}, not 100`);
  }
  const a = [...rubricWeights].sort((x, y) => x - y).join(',');
  const b = [...scorerWeights].sort((x, y) => x - y).join(',');
  if (a !== b) {
    fail(`Rubric weights disagree with the scorer: docs/rubric.md has [${a}], `
      + `lib/score/dimensions.mjs has [${b}] — update both.`);
  } else {
    console.log(`Rubric weights match and sum to 100: [${rubricWeights.join(', ')}]`);
    // The participant docs state the criterion count in prose, and the report computes it.
    // Nothing but this stops the two drifting the next time a criterion is added.
    const criterionCount = DIMENSIONS.reduce((n, d) => n + d.criteria.length, 0);
    for (const doc of ['docs/rubric.md', 'docs/participant-one-pager.md']) {
      const text = readFileSync(join(ROOT, doc), 'utf8');
      const stated = [...text.matchAll(/\b(?:all )?(\d+) criteria\b/gi)];
      // Zero matches is indistinguishable from agreement, so a reword would disable this
      // check with no failure — and this loop is the only thing between the docs and drift.
      if (!stated.length) {
        fail(`${doc} no longer states the criterion count as "N criteria" — restore it, `
          + 'or update this check to match the new phrasing.');
      }
      for (const m of stated) {
        if (Number(m[1]) !== criterionCount) {
          fail(`${doc} says "${m[0]}" but the scorer has ${criterionCount} — update both.`);
        }
      }
    }
    console.log(`Criterion count consistent across docs and scorer: ${criterionCount}`);
  }
}

checkSkillFrontmatter();
checkManifestVersions();
checkCanonicalBundledParity();
checkRubricWeights();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log('\nAll kit self-checks passed.');
}
