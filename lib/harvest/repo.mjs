/**
 * repo.mjs — observe what is in the repository itself.
 *
 * Records what exists, how substantive it is, and whether the commands it advertises
 * actually work. It does not score: "an AGENTS.md of 40 lines with 6 unfilled
 * placeholders" is an observation; whether that is worth points is the scorer's problem.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { excerptCollector, source } from './shared.mjs';

const HARNESS_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
  '.cursor/rules',
  'GEMINI.md',
  '.aider.conf.yml',
];

const CONTEXT_DOCS = [
  'docs/project-context.md',
  'docs/business-context.md',
  'docs/architecture.md',
  'docs/ai-infrastructure.md',
];

/** Unfilled scaffolding: {{PLACEHOLDER}}, <!-- FILL ... -->, <!-- REPLACE ... -->. */
const PLACEHOLDER = /\{\{[A-Z_][A-Z0-9_ ,.]*\}\}|<!--\s*(?:FILL|REPLACE|TODO)\b/gi;

/**
 * Secret patterns. Every match is reported by file and line with the value masked —
 * the point is to tell a team they leaked something, never to reproduce it.
 */
const SECRET_PATTERNS = [
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  { name: 'connection-string-password', re: /\b[a-z+]{2,12}:\/\/[^\s:@/]+:[^\s:@/]{4,}@/i },
  {
    name: 'assigned-credential',
    re: /\b(?:api[_-]?key|secret|password|passwd|token|client[_-]?secret)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  },
];

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.venv', 'venv',
  '__pycache__', 'target', 'vendor', '.vibecheck', '.idea', '.gradle',
]);

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.cs', '.php', '.sh', '.ps1', '.yml', '.yaml', '.json', '.toml', '.ini', '.env',
  '.md', '.txt', '.sql', '.tf', '.gradle', '.kt', '.swift', '.vue', '.svelte', '.html',
]);

const TEST_PATH = /(?:^|[/\\])(?:tests?|__tests__|spec|e2e)(?:[/\\]|$)|\.(?:test|spec)\.[a-z]+$|(?:^|[/\\])test_[^/\\]+\.py$|_test\.(?:go|py|rb)$/i;

function walk(root, onFile, { maxFiles = 20000 } = {}) {
  let seen = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (++seen > maxFiles) return { truncated: true, seen };
      onFile(full);
    }
  }
  return { truncated: false, seen };
}

function readIfText(path, maxBytes = 512 * 1024) {
  try {
    if (statSync(path).size > maxBytes) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * How much of this file is still the shipped template? Compared as sets of normalised
 * non-trivial lines, so reordering and reformatting do not hide an untouched template.
 */
function templateSimilarity(content, templatePath) {
  const template = readIfText(templatePath);
  if (!template) return null;
  const normalise = (text) => new Set(
    text.split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l.length > 15)
  );
  const a = normalise(content);
  const b = normalise(template);
  if (!b.size) return null;
  let shared = 0;
  for (const line of a) if (b.has(line)) shared++;
  return Math.round((shared / b.size) * 100) / 100;
}

function describeHarnessFile(repo, rel, kitRoot, budget) {
  const full = join(repo, rel);
  if (!existsSync(full)) return { path: rel, present: false };
  const content = readIfText(full);
  if (content === null) return { path: rel, present: true, unreadable: true };
  const placeholders = content.match(PLACEHOLDER) ?? [];
  const templateCandidates = [
    join(kitRoot, '02-agentic-preparation', 'templates', rel.split(/[/\\]/).pop()),
    join(kitRoot, '02-agentic-preparation', 'templates', 'instructions', rel.split(/[/\\]/).pop()),
  ];
  let similarity = null;
  for (const candidate of templateCandidates) {
    similarity = templateSimilarity(content, candidate);
    if (similarity !== null) break;
  }
  return {
    path: rel,
    present: true,
    bytes: Buffer.byteLength(content, 'utf8'),
    lines: content.split('\n').length,
    unfilledPlaceholders: placeholders.length,
    templateSimilarity: similarity,
    // Bounded, and **redacted**, so a coach's judging pass — which reads only
    // evidence.json, never the repo — has something to judge for "substantive vs.
    // boilerplate" without this becoming a way to republish a leaked credential.
    //
    // Harness files are ordinary tracked source and can contain secrets like any other
    // file: a team documenting "the staging password is X so the agent can run
    // migrations" is exactly the sort of thing that ends up in an AGENTS.md. Every other
    // path in this file masks secrets rather than reproducing them; this one must too,
    // especially since the excerpt is sent to a model by the judging skill.
    contentExcerpt: excerptOf(redactSecrets(content), budget),
  };
}

const HARNESS_EXCERPT_CHARS = 4000;

/** Total excerpt budget across every harness/instruction/context file in one harvest. */
const HARNESS_EXCERPT_TOTAL_CHARS = 60000;

/**
 * Global versions of the detection patterns. The originals are non-global because they
 * only ever answer "does this line match"; replacing every occurrence needs the `g` flag.
 */
const SECRET_PATTERNS_GLOBAL = SECRET_PATTERNS.map(({ name, re }) => ({
  name,
  re: new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'),
}));

/** Replace anything that looks like a credential with a named marker. */
function redactSecrets(text) {
  let out = text;
  for (const { name, re } of SECRET_PATTERNS_GLOBAL) {
    re.lastIndex = 0;
    out = out.replace(re, '[redacted: ' + name + ']');
  }
  return out;
}

/**
 * Truncate to the per-file cap, and stop emitting excerpts once the whole-harvest budget
 * is spent — a repo with dozens of instruction files should not grow evidence.json
 * without bound.
 */
function excerptOf(content, budget) {
  if (budget && budget.remaining <= 0) return '… (excerpt budget spent)';
  const capped = content.length <= HARNESS_EXCERPT_CHARS
    ? content
    : content.slice(0, HARNESS_EXCERPT_CHARS) + '\n… (truncated)';
  if (budget) budget.remaining -= capped.length;
  return capped;
}

function detectCommands(repo) {
  const found = {};
  const pkgPath = join(repo, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {};
      found.packageManagerScripts = Object.keys(scripts);
      for (const key of ['setup', 'dev', 'start', 'test', 'lint', 'build', 'ci', 'typecheck']) {
        if (scripts[key]) found[key] = 'npm run ' + key;
      }
      if (scripts.test) found.test = 'npm test';
    } catch { /* malformed package.json — reported as no scripts */ }
  }
  if (existsSync(join(repo, 'pyproject.toml')) || existsSync(join(repo, 'pytest.ini'))) {
    found.test ??= 'pytest';
  }
  if (existsSync(join(repo, 'go.mod'))) found.test ??= 'go test ./...';
  if (existsSync(join(repo, 'Cargo.toml'))) found.test ??= 'cargo test';
  if (existsSync(join(repo, 'Makefile'))) {
    const makefile = readIfText(join(repo, 'Makefile')) ?? '';
    for (const target of ['setup', 'test', 'lint', 'build']) {
      if (new RegExp('^' + target + ':', 'm').test(makefile)) found[target] ??= 'make ' + target;
    }
  }
  return found;
}

/**
 * Kill a process and everything it spawned.
 *
 * Node's own `timeout` option signals only the process it started. A test command is
 * normally run through a shell, which starts a runner, which starts workers — so a
 * hanging suite leaves those grandchildren running on the team's machine after the
 * harvester exits. Windows needs taskkill for tree termination; elsewhere the child is
 * spawned as a process-group leader so the group can be signalled by negative pid.
 */
function killTree(child) {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

function runTests(repo, command, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: repo, shell: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let timedOut = false;
    const append = (chunk) => {
      output += chunk;
      // Keep only the tail: a chatty suite must not be able to exhaust memory.
      if (output.length > 64 * 1024) output = output.slice(-32 * 1024);
    };
    child.stdout?.on('data', (c) => append(String(c)));
    child.stderr?.on('data', (c) => append(String(c)));

    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);

    const finish = (exitCode) => {
      clearTimeout(timer);
      resolve({
        ran: true,
        timedOut,
        exitCode: timedOut ? null : exitCode,
        durationMs: Date.now() - started,
        tail: output.slice(-4000),
      });
    };
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ran: false, reason: 'could not start test command: ' + err.message });
    });
    child.on('close', (code) => finish(code));
  });
}

export async function harvestRepo(repo, { kitRoot, runTestSuite = true, testTimeoutMs = 120000 } = {}) {
  if (!existsSync(repo)) {
    return { source: source.notHarvested('repository path does not exist: ' + repo) };
  }

  // One shared budget so the excerpts across every file stay bounded in total, not just
  // per file.
  const excerptBudget = { remaining: HARNESS_EXCERPT_TOTAL_CHARS };
  const harnessFiles = HARNESS_FILES.map((rel) => describeHarnessFile(repo, rel, kitRoot, excerptBudget));
  const instructionsDir = join(repo, '.github', 'instructions');
  const instructionFiles = existsSync(instructionsDir)
    ? readdirSync(instructionsDir).filter((f) => f.endsWith('.md')).map((f) => describeHarnessFile(repo, '.github/instructions/' + f, kitRoot, excerptBudget))
    : [];

  const contextDocs = CONTEXT_DOCS.map((rel) => describeHarnessFile(repo, rel, kitRoot, excerptBudget));

  const secrets = excerptCollector(10);
  const testFiles = [];
  let filesScanned = 0;
  const walkResult = walk(repo, (full) => {
    filesScanned++;
    const rel = relative(repo, full);
    if (TEST_PATH.test(rel)) testFiles.push(rel);
    if (!TEXT_EXTENSIONS.has(extname(full).toLowerCase())) return;
    const content = readIfText(full, 256 * 1024);
    if (content === null) return;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const { name, re } of SECRET_PATTERNS) {
        const match = lines[i].match(re);
        if (!match) continue;
        secrets.offer(name + ' at ' + rel + ':' + (i + 1), { rule: name, file: rel, line: i + 1 });
        break;
      }
    }
  });

  const commands = detectCommands(repo);
  const gitignore = readIfText(join(repo, '.gitignore')) ?? '';
  const workflowsDir = join(repo, '.github', 'workflows');
  const workflows = existsSync(workflowsDir)
    ? readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))
    : [];

  let testRun = { ran: false, reason: 'skipped by flag' };
  if (runTestSuite && commands.test) {
    testRun = await runTests(repo, commands.test, testTimeoutMs);
    testRun.command = commands.test;
  } else if (runTestSuite) {
    testRun = { ran: false, reason: 'no test command detected' };
  }

  return {
    source: source.harvested({ filesScanned, truncated: walkResult.truncated }),
    harnessFiles,
    instructionFiles,
    contextDocs,
    commands,
    tests: {
      testFileCount: testFiles.length,
      sample: testFiles.slice(0, 10),
      run: testRun,
    },
    ci: {
      workflowCount: workflows.length,
      workflows,
    },
    safety: {
      secretFindings: secrets.result(),
      envFilePresent: existsSync(join(repo, '.env')),
      envExamplePresent: existsSync(join(repo, '.env.example')),
      gitignoreCoversEnv: /^\s*\.env\b/m.test(gitignore),
      gitignorePresent: gitignore.length > 0,
      claudeSettingsPresent: existsSync(join(repo, '.claude', 'settings.json'))
        || existsSync(join(repo, '.claude', 'settings.local.json')),
    },
    reproducibility: {
      readmePresent: existsSync(join(repo, 'README.md')),
      readmeBytes: existsSync(join(repo, 'README.md'))
        ? Buffer.byteLength(readIfText(join(repo, 'README.md')) ?? '', 'utf8') : 0,
      setupCommand: commands.setup ?? null,
      runCommand: commands.dev ?? commands.start ?? null,
      lockfilePresent: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock',
        'Cargo.lock', 'go.sum', 'requirements.txt'].some((f) => existsSync(join(repo, f))),
      containerised: existsSync(join(repo, '.devcontainer')) || existsSync(join(repo, 'Dockerfile')),
    },
  };
}
