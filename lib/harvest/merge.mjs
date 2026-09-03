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
import { describeScale, summariseSessions } from './index.mjs';

/** Session lists in an evidence file, by the tool that produced them. */
export const CHAT_SOURCES = ['claudeCode', 'copilot', 'codex', 'cursor'];

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
  return [...members].sort((a, b) => {
    const commits = (b.evidence.gitEvidence?.commitCount ?? 0) - (a.evidence.gitEvidence?.commitCount ?? 0);
    if (commits !== 0) return commits;
    const ran = Number(Boolean(b.evidence.repoEvidence?.tests?.run?.ran))
      - Number(Boolean(a.evidence.repoEvidence?.tests?.run?.ran));
    if (ran !== 0) return ran;
    // Last resort: the most recent harvest, which is the closest to hand-in.
    return String(b.evidence.harvestedAt ?? '').localeCompare(String(a.evidence.harvestedAt ?? ''));
  })[0];
}

/**
 * Combine several harvests of the same repository.
 *
 * @param {{label: string, evidence: object}[]} members  one entry per machine
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
  const names = [...new Set(members.map((m) => m.evidence?.repo?.name).filter(Boolean))];
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
  // from a member who could not read it, so "not-harvested" still says why.
  const sources = {};
  for (const key of Object.keys(base.sources ?? {})) {
    const all = members.map((m) => m.evidence?.sources?.[key]).filter(Boolean);
    sources[key] = all.find((s) => s.status === 'harvested')
      ?? all.find((s) => s.status === 'empty')
      ?? all[0] ?? { status: 'not-harvested', reason: 'not reported by any member' };
  }

  const evidence = {
    schemaVersion: base.schemaVersion,
    harvestedAt: new Date().toISOString(),
    // Kept from the member whose repository state is being used, so the two always agree.
    repo: base.repo,
    /**
     * Who contributed what. This is the audit trail for a merged score: a team disputing
     * a number can see which machines were included, and a facilitator can see at a glance
     * whether somebody's laptop was left out.
     */
    merged: {
      memberCount: members.length,
      repoStateFrom: primary.label,
      members: members.map((m) => ({
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
    scale: describeScale(groups, base.gitEvidence, { memberHarvests: members.length }),
    chat: {
      totals: summariseSessions(groups),
      claudeCode: byTool.claudeCode,
      copilot: byTool.copilot,
      codex: byTool.codex,
      cursor: byTool.cursor,
    },
  };

  return { evidence, warnings };
}
