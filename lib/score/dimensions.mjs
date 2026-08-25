/**
 * dimensions.mjs — the rubric, expressed as criteria a machine can evaluate.
 *
 * Each criterion returns a status, the points earned, the evidence that decided it, and —
 * when points were lost — a plain-language reason the team can act on without a coach.
 * That reason is the product. The number is just the headline.
 *
 * The weights here must match docs/rubric.md and the participant material. They sum to
 * exactly 100; `assertWeightsSumTo100` in ./index.mjs enforces it at load time.
 *
 * A criterion whose evidence source was not harvested returns status 'not-harvested'.
 * That is not a zero: it is excluded from both the earned and the available totals, so a
 * team is never punished for using a tool this kit cannot read.
 */

const pass = (earned, evidence) => ({ status: 'pass', earned, evidence });
const partial = (earned, evidence, reason) => ({ status: 'partial', earned, evidence, reason });
const fail = (evidence, reason) => ({ status: 'fail', earned: 0, evidence, reason });
const unharvested = (reason) => ({ status: 'not-harvested', earned: 0, reason });

/**
 * Criterion ids a coach's judging pass (story 4) can override. Kept as one list so
 * `index.mjs` can tell whether a "subjective" criterion is still on its deterministic
 * fallback — which is what makes a final score provisional until a coach has judged it.
 */
export const JUDGED_CRITERIA = ['iterative-direction', 'harness-is-substantive'];

/**
 * Apply a coach's judgement to a criterion, if one was supplied and is well-formed.
 * Returns null when there is nothing usable to apply — the caller then falls back to its
 * own deterministic heuristic, which is what keeps `vibecheck` useful all day in practice
 * mode, long before any coach has judged anything.
 *
 * A judgement is trusted data by the time it reaches this function — the defence against
 * a team manipulating the *content* being judged lives in the judging skill's prompt
 * design (repo/transcript text enters as a quoted data envelope, never as instructions),
 * and independently in story 3's injection scan, which zeroes the whole score regardless
 * of what any judgement says. This function only validates the judgement's *shape*.
 */
function applyJudgement(judgement, criterionId, maxPoints) {
  const entry = judgement?.criteria?.[criterionId];
  if (!entry) return null;
  const points = entry.points;
  const justification = typeof entry.justification === 'string' ? entry.justification.trim() : '';
  if (typeof points !== 'number' || !Number.isFinite(points) || !justification) return null;

  // Rounded as well as clamped. The rubric promises whole points out of 100, and a
  // judgement of 5.7 would otherwise propagate all the way to a total of 55.7 on the
  // leaderboard and in the count-up animation.
  const capped = Math.max(0, Math.min(maxPoints, Math.round(points)));
  const model = judgement.model ? ' (' + judgement.model + ')' : '';
  const evidence = 'coach judging pass' + model + ': ' + justification;
  const outcome = capped >= maxPoints ? pass(maxPoints, evidence)
    : capped <= 0 ? fail(evidence, justification)
    : partial(capped, evidence, justification);
  // Explicit marker rather than sniffing the evidence text: this is what index.mjs uses
  // to tell a real judgement apart from the deterministic fallback.
  return { ...outcome, judged: true };
}

const chatMissing = (ev) => ev.noChatEvidence;

/** Ratio of agent actions to human instructions; NaN-safe. */
function toolCallsPerPrompt(totals) {
  return totals.userPrompts > 0 ? totals.toolCalls / totals.userPrompts : 0;
}

export const DIMENSIONS = [
  {
    id: 'working-method',
    label: 'Working Method',
    points: 25,
    measuredBy: 'your AI chat transcripts',
    criteria: [
      {
        id: 'iterative-direction',
        label: 'Directed the agent repeatedly rather than once',
        points: 8,
        evaluate(ev, { judgement } = {}) {
          // A coach's read of the actual goal-decomposition quality in the prompts, when
          // available, replaces this heuristic proxy rather than sitting alongside it.
          const judged = applyJudgement(judgement, 'iterative-direction', 8);
          if (judged) return judged;
          if (chatMissing(ev)) return unharvested('no readable chat transcripts');
          const t = ev.chat.totals;
          const ratio = toolCallsPerPrompt(t);
          const evidence = t.userPrompts + ' prompts across ' + t.sessionCount
            + ' session(s), ' + t.toolCalls + ' tool calls ('
            + ratio.toFixed(1) + ' per prompt)';
          if (t.userPrompts === 0) return fail(evidence, 'No prompts were recorded at all.');
          if (t.userPrompts < 5) {
            return partial(3, evidence,
              'Only ' + t.userPrompts + ' prompt(s). A whole build handed over in a couple of '
              + 'instructions means the agent chose the design, not you. Break the work into '
              + 'goals you can check one at a time.');
          }
          if (ratio > 80) {
            return partial(5, evidence,
              'The agent averaged ' + ratio.toFixed(0) + ' actions per instruction — long '
              + 'unsupervised stretches. Step in more often to check direction before it '
              + 'compounds.');
          }
          return pass(8, evidence);
        },
      },
      {
        id: 'prompts-carry-context',
        label: 'Prompts carried enough context to act on',
        points: 6,
        evaluate(ev) {
          if (chatMissing(ev)) return unharvested('no readable chat transcripts');
          // The exact mean across every prompt, derived from per-session totals. An
          // earlier version quoted a "median" that was really the median of per-session
          // means — a different number, described inaccurately to the team.
          const mean = ev.chat.totals.promptLength.mean ?? 0;
          const evidence = 'average prompt length ' + mean + ' characters across '
            + (ev.chat.totals.promptLength.count ?? 0) + ' prompts';
          if (mean === 0) return fail(evidence, 'No prompt text was recorded.');
          if (mean < 60) {
            return partial(2, evidence,
              'Prompts averaged ' + mean + ' characters — close to "fix it". The agent '
              + 'cannot know what you know; state the goal and the constraint.');
          }
          if (mean > 6000) {
            return partial(4, evidence,
              'Prompts averaged ' + mean + ' characters. Dumping a specification each turn '
              + 'buries the actual ask — put durable context in AGENTS.md and keep the '
              + 'prompt to the goal.');
          }
          return pass(6, evidence);
        },
      },
      {
        id: 'course-correction',
        label: 'Read the output and corrected course',
        points: 6,
        evaluate(ev) {
          if (chatMissing(ev)) return unharvested('no readable chat transcripts');
          const { corrections, userPrompts } = ev.chat.totals;
          const evidence = corrections + ' correcting turn(s) out of ' + userPrompts + ' prompts';
          if (corrections >= 2) return pass(6, evidence);
          if (corrections === 1) {
            return partial(3, evidence,
              'One correction across the whole build. Either it went unusually well, or '
              + 'output was accepted without being read.');
          }
          return fail(evidence,
            'The agent was never redirected. Over a full build that almost always means its '
            + 'output was accepted without being read closely.');
        },
      },
      {
        id: 'planned-before-building',
        label: 'Planned before building',
        points: 5,
        evaluate(ev) {
          const planUses = ev.noChatEvidence ? 0 : (ev.chat.totals.planningSignals ?? 0);
          const journalled = ev.journalEvidence?.substantiveEntries ?? 0;
          const evidence = 'planning signals (plan mode, todo lists, planner skills): '
            + planUses + ', journal entries: ' + journalled;
          if (planUses >= 1 && journalled >= 1) return pass(5, evidence);
          if (planUses >= 1 || journalled >= 1) {
            return partial(3, evidence,
              'Some planning is visible, but not consistently. Agreeing an approach before '
              + 'code is where you make the decisions instead of reviewing them afterwards.');
          }
          if (chatMissing(ev) && journalled === 0) {
            return unharvested('no readable chat transcripts and no journal entries');
          }
          return fail(evidence,
            'No planning step is visible — no plan mode, no todo list, no journal entry. '
            + 'The agent went straight from instruction to code every time.');
        },
      },
    ],
  },

  {
    id: 'verification-loop',
    label: 'Verification Loop',
    points: 25,
    measuredBy: 'your transcripts and your test suite',
    criteria: [
      {
        id: 'tests-exist',
        label: 'Automated tests exist',
        points: 5,
        evaluate(ev) {
          const count = ev.repoEvidence?.tests?.testFileCount ?? 0;
          const evidence = count + ' test file(s) found';
          if (count >= 3) return pass(5, evidence);
          if (count >= 1) {
            return partial(3, evidence,
              'Only ' + count + ' test file(s). Enough to prove the runner works, not enough '
              + 'to catch a regression.');
          }
          return fail(evidence,
            'No test files found. Without them nothing distinguishes working code from code '
            + 'that merely looks right.');
        },
      },
      {
        id: 'suite-runs-green',
        label: 'The suite runs, and passes',
        points: 8,
        evaluate(ev) {
          const run = ev.repoEvidence?.tests?.run ?? {};
          // Skipping the run is the operator's choice, not the team's failing. Scoring it
          // as "no test command" would punish a team for how the scorer was invoked.
          if (!run.ran && run.reason === 'skipped by flag') {
            return unharvested('the test suite was not executed (--no-run-tests); re-run '
              + 'without that flag to have this scored');
          }
          if (!run.ran) {
            return fail(run.reason ?? 'no test command detected',
              'No runnable test command. An agent that cannot run your tests cannot check '
              + 'its own work — it can only claim to have.');
          }
          const evidence = '`' + run.command + '` exited ' + run.exitCode
            + (run.timedOut ? ' (timed out)' : '') + ' in ' + run.durationMs + 'ms';
          if (run.timedOut) {
            return partial(3, evidence,
              'The suite did not finish within the timeout. A suite nobody waits for is a '
              + 'suite nobody runs.');
          }
          if (run.exitCode === 0) return pass(8, evidence);
          return partial(3, evidence,
            'The suite runs but is red at hand-in. Finishing with failing tests means the '
            + 'last thing you built was never verified.');
        },
      },
      {
        id: 'agent-ran-tests',
        label: 'Tests were run during the work, not just at the end',
        points: 6,
        evaluate(ev) {
          if (chatMissing(ev)) return unharvested('no readable chat transcripts');
          const runs = ev.chat.totals.testRuns;
          const evidence = runs.total + ' test run(s) in transcripts ('
            + runs.pass + ' pass, ' + runs.fail + ' fail)';
          if (runs.total >= 5) return pass(6, evidence);
          if (runs.total >= 1) {
            return partial(3, evidence,
              'Tests ran ' + runs.total + ' time(s) during the whole build. Running them '
              + 'after each change is what turns them into a feedback loop.');
          }
          return fail(evidence,
            'Tests were never run during the session. Whatever the agent said about its work '
            + 'was unverified when it said it.');
        },
      },
      {
        id: 'failures-were-closed',
        label: 'Failures were fixed and re-verified',
        points: 6,
        evaluate(ev) {
          if (chatMissing(ev)) return unharvested('no readable chat transcripts');
          const loops = ev.chat.totals.failThenPassSequences;
          const failures = ev.chat.totals.testRuns.fail;
          const evidence = loops + ' fail-then-pass loop(s) across ' + failures + ' failing run(s)';
          if (loops >= 2) return pass(6, evidence);
          if (loops === 1) return partial(3, evidence, 'One failure was driven back to green. Good — do it every time.');
          if (failures === 0) {
            return partial(3, evidence,
              'No failing test runs to recover from. Either the work was unusually smooth, or '
              + 'the tests are not exercising enough to fail.');
          }
          return fail(evidence,
            failures + ' failing run(s) with no recorded return to green. Failures were seen '
            + 'and not closed out.');
        },
      },
    ],
  },

  {
    id: 'context-and-harness',
    label: 'Context & Harness',
    points: 20,
    measuredBy: 'your repo and git timestamps',
    criteria: [
      {
        id: 'instruction-layer-exists',
        label: 'An instruction layer exists',
        points: 5,
        evaluate(ev) {
          const files = (ev.repoEvidence?.harnessFiles ?? []).filter((f) => f.present);
          const evidence = files.length
            ? files.map((f) => f.path + ' (' + f.lines + ' lines)').join(', ')
            : 'no AGENTS.md, CLAUDE.md or copilot-instructions.md';
          if (!files.length) {
            return fail(evidence,
              'No instruction file at all. Every session started with the agent knowing '
              + 'nothing about your project.');
          }
          const biggest = Math.max(...files.map((f) => f.lines ?? 0));
          if (biggest < 25) {
            return partial(2, evidence,
              'The instruction layer is ' + biggest + ' lines — too thin to change how the '
              + 'agent behaves.');
          }
          return pass(5, evidence);
        },
      },
      {
        id: 'harness-is-substantive',
        label: 'It contains your project’s real rules, not template text',
        points: 6,
        evaluate(ev, { judgement } = {}) {
          const judged = applyJudgement(judgement, 'harness-is-substantive', 6);
          if (judged) return judged;
          const files = (ev.repoEvidence?.harnessFiles ?? []).filter((f) => f.present);
          if (!files.length) return fail('no instruction files', 'Nothing to assess — see above.');
          const placeholders = files.reduce((n, f) => n + (f.unfilledPlaceholders ?? 0), 0);
          const similarity = Math.max(...files.map((f) => f.templateSimilarity ?? 0));
          const evidence = placeholders + ' unfilled placeholder(s), highest template similarity '
            + similarity;
          if (placeholders === 0 && similarity < 0.5) return pass(6, evidence);
          if (placeholders > 0 && similarity >= 0.5) {
            return fail(evidence,
              'The instruction file is still largely the shipped template, with '
              + placeholders + ' placeholder(s) never filled in. It tells the agent nothing '
              + 'it did not already know.');
          }
          if (placeholders > 0) {
            return partial(3, evidence,
              placeholders + ' placeholder(s) were never filled in. Each one is a question '
              + 'about your project the agent had to guess at.');
          }
          return partial(3, evidence,
            'Most lines still match the template. The value is in the parts only your team '
            + 'could write.');
        },
      },
      {
        id: 'commands-documented',
        label: 'The commands an agent needs are discoverable',
        points: 4,
        evaluate(ev) {
          const commands = ev.repoEvidence?.commands ?? {};
          const named = ['setup', 'test', 'dev', 'start', 'lint', 'build']
            .filter((k) => commands[k]);
          const evidence = named.length ? named.join(', ') : 'none detected';
          if (named.length >= 3) return pass(4, evidence);
          if (named.length >= 1) {
            const list = named.length === 1
              ? 'a ' + named[0] + ' command is'
              : named.slice(0, -1).join(', ') + ' and ' + named.at(-1) + ' commands are';
            return partial(2, evidence,
              'Only ' + list + ' discoverable. An agent that cannot set up and run your '
              + 'project cannot check its own work.');
          }
          return fail(evidence,
            'No setup, run or test command is discoverable from the repo.');
        },
      },
      {
        id: 'harness-preceded-code',
        label: 'The harness existed before the bulk of the code',
        points: 5,
        evaluate(ev) {
          const timing = ev.gitEvidence?.harnessTiming ?? [];
          if (ev.gitEvidence?.source?.status !== 'harvested') {
            return unharvested('no git history to compare against');
          }
          if (!timing.length) {
            return fail('no harness file appears in git history',
              'The instruction layer was never committed, so it cannot have been shared with '
              + 'the team or used by anyone else.');
          }
          const early = timing.filter((t) => t.precededMedianCommit);
          const evidence = timing
            .map((t) => t.path + ' added with ' + t.commitsAfterItAppeared + ' commit(s) after')
            .join('; ');
          if (early.length) return pass(5, evidence);
          const most = Math.max(...timing.map((t) => t.commitsAfterItAppeared ?? 0));
          if (most >= 3) return partial(3, evidence, 'The harness arrived late but was still used for some of the work.');
          return fail(evidence,
            'The harness was committed after essentially all of the code. Written at the end, '
            + 'it guided nothing — it describes work that was already done.');
        },
      },
    ],
  },

  {
    id: 'safety-and-boundaries',
    label: 'Safety & Boundaries',
    points: 10,
    measuredBy: 'your repo',
    criteria: [
      {
        id: 'no-secrets',
        label: 'No secrets in tracked files',
        points: 5,
        evaluate(ev) {
          const findings = ev.repoEvidence?.safety?.secretFindings;
          const count = findings?.offered ?? 0;
          // A clean result from an incomplete scan is not a clean result. The file walk
          // stops at its cap on very large repos, and awarding full marks off a partial
          // sweep would be exactly the silent pass this kit tells teams to avoid.
          if (count === 0 && ev.repoEvidence?.source?.truncated) {
            return unharvested('the file scan hit its limit before finishing, so "no secrets '
              + 'found" cannot be trusted — a coach should re-run it on a narrower path');
          }
          if (count === 0) return pass(5, 'no secret patterns matched');
          const where = (findings.kept ?? []).slice(0, 3)
            .map((f) => f.file + ':' + f.line).join(', ');
          return fail(count + ' finding(s): ' + where,
            count + ' possible secret(s) committed. Rotate anything real, move it to an '
            + 'environment variable, and remember that deleting it from the working tree '
            + 'does not remove it from git history.');
        },
      },
      {
        id: 'env-handling',
        label: 'Environment files handled properly',
        points: 2,
        evaluate(ev) {
          const safety = ev.repoEvidence?.safety ?? {};
          const tracked = ev.gitEvidence?.trackedEnvFiles ?? [];
          const evidence = '.gitignore covers .env: ' + !!safety.gitignoreCoversEnv
            + ', tracked env files: ' + tracked.length;
          if (tracked.length) {
            return fail(evidence, 'An environment file is committed: ' + tracked.join(', ') + '.');
          }
          if (!safety.gitignorePresent) {
            return fail(evidence, 'No .gitignore, so nothing stops a secret being committed by accident.');
          }
          if (!safety.gitignoreCoversEnv) {
            return partial(1, evidence, '.gitignore does not cover .env files.');
          }
          return pass(2, evidence);
        },
      },
      {
        id: 'deliberate-boundaries',
        label: 'Boundaries were a decision, not a default',
        points: 3,
        evaluate(ev) {
          const settings = ev.repoEvidence?.safety?.claudeSettingsPresent;
          const destructive = ev.noChatEvidence ? null : ev.chat.totals.commands.destructive;
          const evidence = 'permission settings committed: ' + !!settings
            + (destructive === null ? '' : ', destructive commands run: ' + destructive);
          if (settings) return pass(3, evidence);
          if (destructive === null) return partial(2, evidence, 'No committed permission settings, and no transcripts to judge command hygiene from.');
          if (destructive === 0) return pass(3, evidence);
          if (destructive <= 4) {
            return partial(2, evidence,
              destructive + ' destructive command(s) run with no committed permission policy.');
          }
          return partial(1, evidence,
            destructive + ' destructive commands and no permission policy. Decide up front '
            + 'what an agent may do without asking.');
        },
      },
    ],
  },

  {
    id: 'reproducibility',
    label: 'Reproducibility & Handover',
    points: 10,
    measuredBy: 'your repo',
    criteria: [
      {
        id: 'readme',
        label: 'A README that explains the project',
        points: 3,
        evaluate(ev) {
          const repro = ev.repoEvidence?.reproducibility ?? {};
          const evidence = repro.readmePresent ? repro.readmeBytes + ' bytes' : 'no README.md';
          if (!repro.readmePresent) return fail(evidence, 'No README. Someone arriving cold has nowhere to start.');
          if (repro.readmeBytes < 400) {
            return partial(1, evidence,
              'The README is ' + repro.readmeBytes + ' bytes — a title and little else.');
          }
          return pass(3, evidence);
        },
      },
      {
        id: 'setup-documented',
        label: 'Setup works from a fresh clone',
        points: 4,
        evaluate(ev) {
          const repro = ev.repoEvidence?.reproducibility ?? {};
          const evidence = 'setup command: ' + (repro.setupCommand ?? 'none')
            + ', run command: ' + (repro.runCommand ?? 'none')
            + ', containerised: ' + !!repro.containerised;
          if (repro.setupCommand || repro.containerised) return pass(4, evidence);
          if (repro.runCommand) {
            return partial(2, evidence,
              'There is a run command but no setup step, so a newcomer has to work out the '
              + 'prerequisites themselves.');
          }
          return fail(evidence,
            'Neither a setup nor a run command is discoverable. In practice this project only '
            + 'runs on the machine that built it.');
        },
      },
      {
        id: 'dependencies-pinned',
        label: 'Dependencies are pinned',
        points: 3,
        evaluate(ev) {
          const locked = ev.repoEvidence?.reproducibility?.lockfilePresent;
          return locked
            ? pass(3, 'lockfile present')
            : fail('no lockfile',
              'No lockfile committed, so two people installing on different days get '
              + 'different code.');
        },
      },
    ],
  },

  {
    id: 'it-actually-works',
    label: 'It Actually Works',
    points: 10,
    measuredBy: 'a coach, watching your demo',
    coachScored: true,
    criteria: [
      {
        id: 'demo',
        label: 'The use case runs and does what it claims',
        points: 10,
        evaluate(ev, { coachScorecard } = {}) {
          const entry = coachScorecard?.demo;
          if (!entry || typeof entry.points !== 'number') {
            return unharvested('awaiting a coach’s demo score');
          }
          const capped = Math.max(0, Math.min(10, entry.points));
          const evidence = 'coach score ' + capped + '/10'
            + (entry.note ? ' — ' + entry.note : '');
          if (capped === 10) return pass(10, evidence);
          if (capped === 0) return fail(evidence, entry.note ?? 'The demo did not work.');
          return partial(capped, evidence, entry.note ?? 'Partially working at demo time.');
        },
      },
    ],
  },
];
