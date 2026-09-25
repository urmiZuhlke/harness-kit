/**
 * submission.mjs — find a team's proposal deck and SDLC diagram, and count the deck's pages.
 *
 * Shared by the participant's pre-flight (bundled into dist/collect-history.mjs, so node:
 * built-ins only) and the facilitator's prepare step, so both say the same thing about
 * the same repository: a team told "found" on the day before must not be scored "missing".
 *
 * Only PDFs and PNG/JPEG images are ever read. A PowerPoint file is *reported* — so a team
 * can be warned it will not be read — and never opened.
 */
import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inflateSync } from 'node:zlib';

/** Where a deck is expected unless an event says otherwise. */
export const DEFAULT_DECK_PATH = 'submission/proposal.pdf';

/**
 * Where the SDLC diagram is expected, as its own image. A diagram on its own is read far
 * more reliably than one found among ten slides, so it is the primary source; the deck's
 * diagram slide is the fallback.
 */
export const DIAGRAM_PATHS = ['submission/sdlc-diagram.png', 'submission/sdlc-diagram.jpg', 'submission/sdlc-diagram.jpeg'];

const SKIP = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.venv', 'venv',
  '__pycache__', 'target', 'vendor', '.vibecheck', '.idea', '.gradle', 'obj',
]);

/** Every PDF, PowerPoint and PNG/JPEG file in the repository, as repo-relative paths. */
function listCandidates(repo, maxEntries = 20000) {
  const pdf = [];
  const pptx = [];
  const images = [];
  const stack = [repo];
  let seen = 0;
  while (stack.length && seen < maxEntries) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (++seen >= maxEntries) break;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(repo, full).split('\\').join('/');
      if (/\.pdf$/i.test(entry.name)) pdf.push(rel);
      else if (/\.pptx?$/i.test(entry.name)) pptx.push(rel);
      else if (/\.(?:png|jpe?g)$/i.test(entry.name)) images.push(rel);
    }
  }
  return { pdf: pdf.sort(), pptx: pptx.sort(), images: images.sort() };
}

/** Higher is more likely to be the deck. Name first, then where it sits, then how deep. */
function deckLikelihood(rel) {
  let score = 0;
  if (DECK_WORD.test(rel)) score += 4;
  if (/^submission\//i.test(rel)) score += 2;
  else if (/^docs?\//i.test(rel)) score += 1;
  return score * 100 - rel.split('/').length;
}

/**
 * PDFs that are something other than the team's deck: the client's brief or spec a team
 * kept for reference, or the diagram exported on its own. Guessing one of those as the
 * deck would have a judge score the client's own document as the team's proposal.
 */
const NOT_A_DECK = /brief|spec(?:ification)?s?\b|requirements?|zahtev|zadatak|assignment|(?:^|[^a-z])task(?:[^a-z]|$)|sdlc|diagram/i;

/** Words that say "this is the offer", which win over NOT_A_DECK ("AI SDLC Proposal.pdf"). */
const DECK_WORD = /proposal|deck|pitch|presentation|offer|ponuda|prezentacija/i;

const notADeck = (rel) => { const name = rel.split('/').pop(); return NOT_A_DECK.test(name) && !DECK_WORD.test(name); };

/** A regular file — never a symlink, which could point anywhere on this machine. */
function isRegularFile(path) {
  try { return lstatSync(path).isFile(); } catch { return false; }
}

/** The first bytes of a file, as latin1 text. */
function head(path, n = 64) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(n);
    const read = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read).toString('latin1');
  } catch { return ''; } finally { if (fd !== undefined) closeSync(fd); }
}

/** Git LFS checks out a small text pointer when git-lfs is not installed. */
const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec/;

/** `ok`, `lfs-pointer` or `not-a-pdf`, from the file's first bytes. */
function pdfState(path) {
  // The PDF header may follow a few bytes of junk (a byte-order mark, a stray line from a
  // writer); readers accept it within the first kilobyte, so this does too.
  const start = head(path, 1024);
  if (start.includes('%PDF-')) return 'ok';
  return LFS_POINTER.test(start) ? 'lfs-pointer' : 'not-a-pdf';
}

/**
 * Where the team's deck is, if anywhere.
 *
 * @returns {{status: 'found'|'misplaced'|'pptx-only'|'missing'|'lfs-pointer'|'not-a-pdf',
 *            path: string|null, bytes: number|null, otherPdfs: string[], pptx: string[]}}
 *   `misplaced` means the expected path is empty but a PDF exists elsewhere; `path` is the
 *   likeliest candidate. `pptx-only` means no PDF at all but a PowerPoint file — which is
 *   still no proposal, because a PPTX is not read. `lfs-pointer` and `not-a-pdf` mean the
 *   file is there but is not a readable PDF: something a facilitator can fix (`git lfs
 *   pull`) before judging, never something to score as missing. Symlinks are ignored.
 */
export function findDeck(repo, deckPath = DEFAULT_DECK_PATH) {
  const { pdf, pptx } = listCandidates(repo);
  const size = (rel) => { try { return lstatSync(join(repo, rel)).size; } catch { return null; } };
  if (isRegularFile(join(repo, deckPath))) {
    const state = pdfState(join(repo, deckPath));
    return {
      status: state === 'ok' ? 'found' : state, path: deckPath, bytes: size(deckPath),
      otherPdfs: pdf.filter((p) => p !== deckPath), pptx,
    };
  }
  const candidates = pdf.filter((p) => !notADeck(p) && pdfState(join(repo, p)) === 'ok');
  if (candidates.length) {
    const ranked = [...candidates].sort((a, b) => deckLikelihood(b) - deckLikelihood(a) || a.localeCompare(b));
    return {
      status: 'misplaced', path: ranked[0], bytes: size(ranked[0]),
      otherPdfs: pdf.filter((p) => p !== ranked[0]), pptx,
    };
  }
  return { status: pptx.length ? 'pptx-only' : 'missing', path: null, bytes: null, otherPdfs: pdf, pptx };
}

/** `png`, `jpg` or null, from the file's bytes — whatever the file is called. */
export function imageFormat(path) {
  const start = Buffer.from(head(path, 4), 'latin1');
  if (start[0] === 0x89 && start[1] === 0x50 && start[2] === 0x4e && start[3] === 0x47) return 'png';
  if (start[0] === 0xff && start[1] === 0xd8) return 'jpg';
  return null;
}
const isImage = (path) => imageFormat(path) !== null;

/**
 * Where the team's SDLC diagram image is, if anywhere.
 *
 * `misplaced` is a PNG/JPEG elsewhere whose name says it is the diagram. Screenshots and
 * logos are never guessed at, wherever they sit: a wrong guess would have a judge score
 * the wrong picture, and the deck's diagram slide is the fallback. A file at the expected
 * path that is not a real image (a Git LFS pointer, a renamed file) is `lfs-pointer` /
 * `not-an-image`: something to fix before judging, never a reason to fall back.
 *
 * @returns {{status: 'found'|'misplaced'|'missing'|'lfs-pointer'|'not-an-image',
 *            path: string|null, format: 'png'|'jpg'|null, bytes: number|null, notAnImage: string[]}}
 */
export function findDiagram(repo, expected = DIAGRAM_PATHS) {
  const { images } = listCandidates(repo);
  const size = (rel) => { try { return lstatSync(join(repo, rel)).size; } catch { return null; } };
  const present = expected.filter((p) => isRegularFile(join(repo, p)));
  const real = present.find((p) => isImage(join(repo, p)));
  if (real) return { status: 'found', path: real, format: imageFormat(join(repo, real)), bytes: size(real), notAnImage: [] };
  if (present.length) {
    const lfs = present.some((p) => LFS_POINTER.test(head(join(repo, p))));
    return { status: lfs ? 'lfs-pointer' : 'not-an-image', path: present[0], format: null, bytes: size(present[0]), notAnImage: present };
  }
  const notAnImage = [];
  const named = images
    .filter((p) => /sdlc|diagram|lifecycle|workflow/i.test(p.split('/').pop()))
    .sort((a, b) => Number(/^submission\//i.test(b)) - Number(/^submission\//i.test(a))
      || Number(/sdlc/i.test(b)) - Number(/sdlc/i.test(a)) || a.localeCompare(b))
    .find((p) => { if (isImage(join(repo, p))) return true; notAnImage.push(p); return false; });
  if (named) return { status: 'misplaced', path: named, format: imageFormat(join(repo, named)), bytes: size(named), notAnImage };
  return { status: 'missing', path: null, format: null, bytes: null, notAnImage };
}

/** The innermost `<< … >>` dictionaries in a chunk of PDF text. */
const DICT = /<<((?:(?!<<|>>)[\s\S])*)>>/g;

/**
 * Number of pages in a PDF, or null when it cannot be told.
 *
 * No dependencies, so no real PDF parser: the page tree's root `/Type /Pages` dictionary
 * carries the total as `/Count`, and the largest Count is the root's. Modern writers hide
 * those dictionaries inside compressed object streams, so every `/ObjStm` stream is
 * inflated and searched too. When no page tree is found, individual `/Type /Page` objects
 * are counted instead.
 */
export function pdfPageCount(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes.toString('latin1') : String(bytes);
  if (!raw.slice(0, 1024).includes('%PDF-')) return null;
  const texts = [raw];
  const STREAM = /<<((?:(?!stream)[\s\S]){0,2000}?)>>\s*stream\r?\n/g;
  let m;
  while ((m = STREAM.exec(raw))) {
    if (!/\/Type\s*\/ObjStm\b/.test(m[1]) || !/\/FlateDecode\b/.test(m[1])) continue;
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    try { texts.push(inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1')); } catch {
      // Trailing whitespace before `endstream` is legal and upsets zlib; retry without it.
      try {
        texts.push(inflateSync(Buffer.from(raw.slice(start, end).replace(/\s+$/, ''), 'latin1')).toString('latin1'));
      } catch { /* an unreadable stream contributes nothing */ }
    }
  }
  // A PDF saved incrementally appends new versions of changed objects; the last definition
  // of each numbered object is the live one. Taking the largest /Count over all versions
  // counted pages the team had since deleted.
  const latest = new Map();
  const OBJ = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g;
  let o;
  while ((o = OBJ.exec(raw))) latest.set(o[1] + ' ' + o[2], o[3]);
  let root = 0;
  let pages = 0;
  const scan = (text) => {
    for (const d of text.matchAll(DICT)) {
      if (/\/Type\s*\/Pages\b/.test(d[1])) {
        const count = d[1].match(/\/Count\s+(\d+)/);
        if (count) root = Math.max(root, Number(count[1]));
      } else if (/\/Type\s*\/Page(?![A-Za-z])/.test(d[1])) {
        pages++;
      }
    }
  };
  for (const body of latest.values()) scan(body.replace(/stream[\s\S]*?endstream/g, ''));
  for (const text of texts.slice(1)) scan(text);
  if (!latest.size) scan(raw);
  return root || pages || null;
}

/** Page count of a PDF on disk; null when it is missing, unreadable or not a PDF. */
export function pdfPageCountOf(path) {
  try { return pdfPageCount(readFileSync(path)); } catch { return null; }
}
