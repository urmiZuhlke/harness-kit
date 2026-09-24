#!/usr/bin/env node
/**
 * build-collector.mjs — bundle bin/collect-history.mjs into one file participants download.
 *
 * Participants should not have to clone the kit to hand in their history: one file, one
 * `node` command. The collector's source stays in ordinary modules so it is tested like the
 * rest of the kit, and this script stitches it and everything it imports into
 * `dist/collect-history.mjs`.
 *
 * A deliberately tiny bundler rather than a dependency, because the kit has none. It only
 * understands the forms the harvest modules actually use — named and namespace imports,
 * `export function|const|async function|class` — and **refuses** anything else rather than
 * guessing, so a new module using an unsupported form fails the build instead of shipping
 * a broken file. Each module is wrapped in its own function scope, so two modules declaring
 * the same private name cannot collide.
 *
 *   node .github/scripts/build-collector.mjs          # write dist/collect-history.mjs
 *   node .github/scripts/build-collector.mjs --check  # fail if the committed file is stale
 *
 * The output is deterministic — no timestamps — so `--check` (run by kit-check) can compare
 * it byte for byte with what is committed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENTRY = join(ROOT, 'bin', 'collect-history.mjs');
export const OUTPUT = join(ROOT, 'dist', 'collect-history.mjs');

const IMPORT = /^import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+'([^']+)';[ \t]*\r?\n/gm;
const EXPORT = /^export\s+(?:async\s+function\s*\*?|function\s*\*?|const|let|class)\s+(\w+)/gm;

function fail(message) {
  throw new Error('build-collector: ' + message);
}

/** `a, b as c` → [['a','a'], ['b','c']] */
function specifiers(list) {
  return list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
    if (!m) fail('unsupported import specifier "' + s + '"');
    return [m[1], m[2] ?? m[1]];
  });
}

const nodeAlias = (spec) => '__' + spec.replace(/[^A-Za-z0-9]/g, '_');

function parse(path) {
  let text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const rel = relative(ROOT, path).split('\\').join('/');
  if (text.startsWith('#!')) text = text.slice(text.indexOf('\n') + 1);

  const imports = [];
  const body = text.replace(IMPORT, (_, ns, named, from) => {
    imports.push({ ns, named: named ? specifiers(named) : null, from });
    return '';
  });

  // Anything left that looks like an import or re-export is a form this bundler does not
  // understand. Stop, rather than emit a file that fails on a participant's laptop.
  for (const [re, what] of [
    [/^import\s/m, 'an import form'],
    [/^export\s+(?:default|\{|\*)/m, 'a default or re-export'],
    [/import\.meta/, 'import.meta'],
    [/\bimport\(\s*['"]\.{1,2}\//, 'a relative dynamic import'],
  ]) {
    if (re.test(body)) fail(rel + ' uses ' + what + ', which the collector bundle cannot handle');
  }

  const exports = [...body.matchAll(EXPORT)].map((m) => m[1]);
  return { rel, imports, exports, body: body.replace(/^export\s+/gm, '') };
}

/** Every relative module the entry reaches, dependencies before dependants. */
function collect(entry) {
  const order = [];
  const seen = new Map();
  const visit = (path, chain) => {
    if (seen.has(path)) {
      if (!seen.get(path)) fail('circular import: ' + [...chain, path].map((p) => relative(ROOT, p)).join(' → '));
      return;
    }
    seen.set(path, false);
    const mod = parse(path);
    mod.path = path;
    for (const imp of mod.imports) {
      if (imp.from.startsWith('.')) {
        const target = resolve(dirname(path), imp.from);
        if (!existsSync(target)) fail(mod.rel + ' imports missing ' + imp.from);
        imp.target = target;
        visit(target, [...chain, path]);
      } else if (!imp.from.startsWith('node:')) {
        fail(mod.rel + ' imports "' + imp.from + '" — only node: built-ins can be bundled');
      }
    }
    seen.set(path, true);
    order.push(mod);
  };
  visit(entry, []);
  return order;
}

export function build() {
  const modules = collect(ENTRY);
  const ids = new Map(modules.map((m, i) => [m.path, '__m' + i]));
  const nodeSpecs = new Set();

  const bindings = (mod) => mod.imports.map((imp) => {
    const source = imp.from.startsWith('node:') ? nodeAlias(imp.from) : ids.get(imp.target);
    if (imp.from.startsWith('node:')) nodeSpecs.add(imp.from);
    if (imp.ns) return 'const ' + imp.ns + ' = ' + source + ';';
    const list = imp.named.map(([from, as]) => (from === as ? from : from + ': ' + as)).join(', ');
    return 'const { ' + list + ' } = ' + source + ';';
  }).join('\n');

  const entry = modules.pop();
  const parts = modules.map((mod) => [
    '// ─── ' + mod.rel + ' ' + '─'.repeat(Math.max(3, 80 - mod.rel.length)),
    'const ' + ids.get(mod.path) + ' = (() => {',
    bindings(mod),
    mod.body.trim(),
    'return { ' + mod.exports.join(', ') + ' };',
    '})();',
  ].join('\n'));
  const entryBindings = bindings(entry);

  const header = [
    '#!/usr/bin/env node',
    '// GENERATED FILE — do not edit. Built from bin/collect-history.mjs by',
    '// .github/scripts/build-collector.mjs; edit the sources and rebuild.',
    '//',
    '// harness-kit history collector. Run it inside your project folder:',
    '//',
    '//   node collect-history.mjs',
    '//',
    '// It reads your AI chat history for this project on this machine and writes a summary',
    '// to .vibecheck/history-<your name>.json for you to commit. Nothing is uploaded.',
    '// `node collect-history.mjs --help` lists exactly what the file contains.',
    '',
    ...[...nodeSpecs].sort().map((spec) => 'import * as ' + nodeAlias(spec) + " from '" + spec + "';"),
    '',
  ].join('\n');

  return header + parts.join('\n\n') + '\n\n'
    + '// ─── ' + entry.rel + ' ' + '─'.repeat(Math.max(3, 80 - entry.rel.length)) + '\n'
    + entryBindings + '\n' + entry.body.trim() + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundle = build();
  if (process.argv.includes('--check')) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
    if (current !== bundle) {
      console.error('dist/collect-history.mjs is out of date. Run: npm run build:collector');
      process.exit(1);
    }
    console.log('dist/collect-history.mjs is up to date.');
  } else {
    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, bundle, 'utf8');
    console.log('Wrote ' + relative(ROOT, OUTPUT) + ' (' + Math.round(bundle.length / 1024) + ' KB)');
  }
}
