/**
 * merge.mjs — combine evidence harvested on several machines into one team bundle.
 *
 * Transcripts live in a developer's home directory, so a harvest sees one person's work.
 * A team of five therefore produces five partial evidence files, and scoring any one of
 * them measures one member and calls it the team. This merges them.
 *
 * Two rules shape the implementation:
 *
 *   1. **Union the sessions, then recompute every total.** Adding pre-computed totals
 *      together is wrong for anything that is not a plain sum — a mean prompt length
 *      averaged across five averages weights a three-prompt member the same as a
 *      sixty-prompt one, and a fail-then-pass loop is a property of an ordered session,
 *      not a number you can add up. Everything derived is derived again from the merged
 *      session list.
 *   2. **Repo state comes from exactly one member, named in the output.** All five
 *      harvested the same repository, but at different commits and with different test
 *      results. Mixing them would produce a repository that never existed — a lockfile
 *      from one clone, a test run from another. One member is chosen and cited.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HISTORY_DIR, HISTORY_PREFIX } from './history.mjs';
import { describeScale, summariseSessions } from './index.mjs';

/** Session lists in an evidence file, by the tool that produced them. */
export const CHAT_SOURCES = ['claudeCode', 'copilot', 'codex', 'cursor'];

/**
 * Every member's history file committed to a cloned repository, ready for mergeEvidence.
 *
 * A file that is not a history file is named in `skipped` rather than dropped in silence:
 * a member whose file is malformed is otherwise indistinguishable from one who never ran
 * the collector.
 *
 * @returns {{histories: {label: string, evidence: object, file: string}[],
 *            skipped: {path: string, why: string}[]}}
 */
export function loadCommittedHistories(repo) {
  const dir = join(repo, HISTORY_DIR);
  const histories = [];
  const skipped = [];
  let files = [];
  try { files = readdirSync(dir); } catch { /* no .vibecheck — no histories */ }
  for (const file of files.sort()) {
    if (!file.startsWith(HISTORY_PREFIX) || !file.endsWith('.json')) continue;
    let history = null;
    try { history = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { /* reported below */ }
    if (history?.kind !== 'history' || !history.chat) {
      skipped.push({ path: join(dir, file), why: 'not a history file' });
      continue;
    }
    // Skipped here rather than refused by mergeEvidence: one member's outdated file must
    // cost that member's sessions, not the whole team's evidence.
    if ((history.schemaVersion ?? 0) < MINIMUM_SCHEMA_VERSION) {
      skipped.push({ path: join(dir, file), why: 'history schema v' + (history.schemaVersion ?? 0)
        + ' is older than v' + MINIMUM_SCHEMA_VERSION + ' — written by an old collector' });
      continue;
    }
    histories.push({ label: history.member ?? basename(file, '.json'), evidence: history, file });
  }
  return { histories, skipped };
}

/** The schema this merger understands. Anything older lacks the per-tool session lists. */
export const MINIMUM_SCHEMA_VERSION = 3;

/**
 * Which member's repository state to use.
 *
 * The most complete clone wins: most commits first, then whether its test suite actually
 * ran. A member who harvested before the last push would otherwise be able to decide the
 * team's Reproducibility and Verification scores by being listed first.
 */
export function chooseRepoMember(members) {
  // The facilitator's read of the pushed repository, when there is one, is the repository
  // state by definition — a history file carries no repository state at all.
  const repoRead = members.find((m) => m.repoOnly);
  if (repoRead) return repoRead;
  return [...members].sort((a, b) => {
    const commits = (b.evidence.gitEvidence?.commitCount ?? 0) - (a.evidence.gitEvidence?.commitCount ?? 0);
    if (commits !== 0) return commits;
    const ran = Number(Boolean(b.evidence.repoEvidence?.tests?.run?.ran))
      - Number(Boolean(a.evidence.repoEvidence?.tests?.run?.ran));
    if (ran !== 0) return ran;
    // Last resort: the most recent harvest, which is the closest to hand-in. Compared
    // with `<`, not localeCompare: these are ISO-8601 timestamps, where lexicographic
    // order *is* chronological order, and collation rules have no business deciding which
    // team member's repository state the whole score is based on.
    const left = String(a.evidence.harvestedAt ?? '');
    const right = String(b.evidence.harvestedAt ?? '');
    if (left === right) return 0;
    return left < right ? 1 : -1;
  })[0];
}

/**
 * Combine several harvests of the same repository.
 *
 * @param {{label: string, evidence: object, repoOnly?: boolean}[]} members  one entry per
 *   machine. At most one may be `repoOnly`: the facilitator's harvest of the pushed
 *   repository, which supplies the repo and git state but is nobody's chat history and so
 *   is not counted as a member.
 * @returns {{evidence: object, warnings: string[]}}
 */
export function mergeEvidence(members) {
  if (!members.length) throw new Error('nothing to merge: no evidence files were given');

  const warnings = [];
  for (const m of members) {
    const version = m.evidence?.schemaVersion ?? 0;
    if (version < MINIMUM_SCHEMA_VERSION) {
      throw new Error(m.label + ' is evidence schema v' + version + ', which predates '
        + 'per-tool session lists. Re-run vibecheck on that machine with this version of '
        + 'the kit and merge again.');
    }
  }

  // A merge across two different projects would silently produce a team that did twice
  // the work. Names can legitimately differ between clones, so this warns rather than
  // refusing — but it never passes in silence.
  // The facilitator's clone is named whatever they cloned it as, so only the members'
  // own readings of the folder name are compared.
  const people = members.filter((m) => !m.repoOnly);
  const names = [...new Set(people.map((m) => m.evidence?.repo?.name).filter(Boolean))];
  if (names.length > 1) {
    warnings.push('these harvests name different repositories (' + names.join(', ')
      + '). Merging them anyway — check they really are the same project.');
  }

  // Union each tool's sessions, keeping the fullest copy of any session seen twice. Two
  // members who paired at one keyboard, or one member who harvested twice, would
  // otherwise contribute the same prompts more than once.
  const byTool = {};
  const duplicates = [];
  for (const tool of CHAT_SOURCES) {
    const seen = new Map();
    for (const m of members) {
      for (const session of m.evidence?.chat?.[tool] ?? []) {
        const id = session.sessionId;
        if (!id) { seen.set(Symbol('anonymous'), session); continue; }
        const existing = seen.get(id);
        if (!existing) { seen.set(id, session); continue; }
        duplicates.push(tool + ':' + id);
        if ((session.userPrompts ?? 0) > (existing.userPrompts ?? 0)) seen.set(id, session);
      }
    }
    byTool[tool] = [...seen.values()];
  }
  if (duplicates.length) {
    warnings.push(duplicates.length + ' session(s) appeared in more than one harvest and '
      + 'were counted once: ' + duplicates.slice(0, 3).join(', ')
      + (duplicates.length > 3 ? ', …' : ''));
  }

  const groups = CHAT_SOURCES
    .filter((tool) => byTool[tool].length)
    .map((tool) => ({ sessions: byTool[tool] }));

  const primary = chooseRepoMember(members);
  const base = primary.evidence;

  // A source is harvested for the team if it was harvested for anyone. The reason kept is
  // from a member who could not read it, so "not-harvested" still says why — a person's
  // reason first, because the repository read never looks at chat history at all.
  const sources = {};
  const reasonOrder = [...people, ...members.filter((m) => m.repoOnly)];
  for (const key of Object.keys(base.sources ?? {})) {
    const all = reasonOrder.map((m) => m.evidence?.sources?.[key]).filter(Boolean);
    sources[key] = all.find((s) => s.status === 'harvested')
      ?? all.find((s) => s.status === 'empty')
      ?? all[0] ?? { status: 'not-harvested', reason: 'not reported by any member' };
  }

  const evidence = {
    schemaVersion: base.schemaVersion,
    harvestedAt: new Date().toISOString(),
    // Kept from the member whose repository state is being used, so the two always agree.
    repo: base.repo,
    // The team, minus the member: a merged bundle belongs to all of them. Taken from the
    // first member who stamped one, because that is the name they agreed between
    // themselves and it is what a facilitator will look for on the leaderboard.
    team: (() => {
      const stamped = members.map((m) => m.evidence?.team).find((t) => t?.name);
      return stamped ? { name: stamped.name, slug: stamped.slug ?? null, member: null } : null;
    })(),
    /**
     * Who contributed what. This is the audit trail for a merged score: a team disputing
     * a number can see which machines were included, and a facilitator can see at a glance
     * whether somebody's laptop was left out.
     */
    merged: {
      memberCount: people.length,
      repoStateFrom: primary.label,
      members: people.map((m) => ({
        label: m.label,
        harvestedAt: m.evidence?.harvestedAt ?? null,
        repoPath: m.evidence?.repo?.path ?? null,
        sessions: CHAT_SOURCES.reduce((n, t) => n + (m.evidence?.chat?.[t]?.length ?? 0), 0),
        prompts: m.evidence?.chat?.totals?.userPrompts ?? 0,
      })),
      warnings,
    },
    sources,
    noChatEvidence: groups.length === 0,
    repoEvidence: base.repoEvidence,
    gitEvidence: base.gitEvidence,
    journalEvidence: base.journalEvidence,
    scale: describeScale(groups, base.gitEvidence, { memberHarvests: people.length }),
    chat: {
      totals: summariseSessions(groups),
      // Built from CHAT_SOURCES rather than hand-listed, so adding a fifth adapter cannot
      // silently drop its sessions here while every other line in this file handles it.
      ...Object.fromEntries(CHAT_SOURCES.map((tool) => [tool, byTool[tool]])),
    },
  };

  return { evidence, warnings };
}
