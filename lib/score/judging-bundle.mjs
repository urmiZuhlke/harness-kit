/**
 * judging-bundle.mjs — the smallest file the judging pass can work from.
 *
 * Three of the hundred points' worth of criteria need a person's read rather than a count,
 * and that read is done by an AI model. That is the one step in this kit where a team's
 * evidence leaves the machine it was collected on, so what leaves should be what the judge
 * actually opens — and no more.
 *
 * The judge reads exactly three things: the harness file excerpts, the context document
 * excerpts, and the prompt excerpts. It was previously handed the whole evidence file,
 * which also carries the names on every commit, the path to the repository on somebody's
 * laptop, their branch names, the last test run's output, the file and line of anything
 * credential-shaped, and — on a merged bundle — a per-member breakdown naming each person.
 * None of that changes a judgement. All of it is personal data about a hundred people.
 *
 * Everything here is already redacted and length-capped by the harvester; this drops
 * fields, it does not sanitise them.
 */

/** Session lists in an evidence file, by the tool that produced them. */
const CHAT_SOURCES = ['claudeCode', 'copilot', 'codex', 'cursor'];

/** The fields of a harness or context file the judge is asked to assess. */
function describedFile(file) {
  return {
    path: file.path,
    present: file.present,
    lines: file.lines ?? null,
    unfilledPlaceholders: file.unfilledPlaceholders ?? null,
    templateSimilarity: file.templateSimilarity ?? null,
    contentExcerpt: file.contentExcerpt ?? null,
  };
}

/**
 * Reduce a full evidence file to what a judging pass reads.
 *
 * @param {object} evidence  parsed evidence.json, or a merged team bundle
 * @returns {object} a new object; the input is not modified
 */
export function judgingBundle(evidence) {
  const present = (list) => (Array.isArray(list) ? list : [])
    .filter((f) => f?.present)
    .map(describedFile);

  const prompts = {};
  for (const tool of CHAT_SOURCES) {
    const sessions = evidence?.chat?.[tool];
    if (!Array.isArray(sessions) || !sessions.length) continue;
    // Only the prompt excerpts, and only the ones that carry text. Session ids, timings,
    // branch names and tool-call inventories say nothing about goal decomposition.
    const kept = sessions.flatMap((s) => (s?.excerpts?.prompts?.kept ?? [])
      .map((p) => (typeof p === 'string' ? p : p?.text))
      .filter((text) => typeof text === 'string' && text.trim()));
    if (kept.length) prompts[tool] = kept;
  }

  return {
    // Stamped so a judgement written against an old shape is recognisable as one.
    judgingBundleVersion: 1,
    generatedAt: new Date().toISOString(),
    // A name to address the team by. Deliberately not the repository *path*, which names
    // a person's home directory on their own laptop.
    team: evidence?.team?.name ?? evidence?.repo?.name ?? null,
    repoName: evidence?.repo?.name ?? null,
    // How much work these excerpts are drawn from, so "only three prompts" and "three
    // prompts out of four hundred" are distinguishable. Counts only.
    scale: {
      prompts: evidence?.chat?.totals?.userPrompts ?? 0,
      sessions: evidence?.chat?.totals?.sessionCount ?? 0,
      members: evidence?.merged?.memberCount ?? 1,
    },
    harnessFiles: present(evidence?.repoEvidence?.harnessFiles),
    contextDocs: present(evidence?.repoEvidence?.contextDocs),
    promptExcerpts: prompts,
  };
}
