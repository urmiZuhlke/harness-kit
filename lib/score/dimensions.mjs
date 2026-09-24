/**
 * dimensions.mjs — the rubric, expressed as criteria a machine can evaluate.
 *
 * Each criterion carries a static `lookedFor` — what this criterion measures, in plain
 * language — and returns a status, the points earned, the evidence that decided it, and,
 * when points were lost, what to do about it. Those three read together on the report as
 * "what we looked for / what we found / what to do". They are the product; the number is
 * just the headline.
 *
 * **Wording rule.** A `reason` states the finding and the fix, and passes no verdict on
 * the people. These reports are read by the team who did the work, and the aim is to leave
 * them able to act, not judged. "Its output was accepted without being read closely" was
 * real text here; it is a guess about someone's attention dressed up as a measurement.
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
 * Criterion ids a facilitator's judging pass (story 4) can override. Kept as one list so
 * `index.mjs` can tell whether a "subjective" criterion is still on its deterministic
 * fallback — which is what makes a final score provisional until a facilitator has judged it.
 */
export const JUDGED_CRITERIA = [
  'iterative-direction', 'harness-is-substantive', 'domain-context-captured',
];

/**
 * Criteria only a person can settle, recorded on the facilitator scorecard rather than
 * derived from the repo. Kept as one list so `index.mjs` can report them as outstanding
 * work rather than as points lost.
 */
export const FACILITATOR_SCORED = ['demo', 'acceptance-checklist', 'privacy-of-sample-data'];

/**
 * A threshold that grows with how much evidence there is.
 *
 * Every count in this file used to be an absolute tuned for one person working for one
 * day: two corrections, five test runs, two closed loops. Five people working for two
 * days clear all of them before lunch on the first day, so the two heaviest dimensions
 * stopped separating a good team from an excellent one and the ranking fell to whoever
 * had committed a lockfile.
 *
 * `base` is what one person's working day earns, and `perUnit` is how much observed
 * volume buys one more. Because the result is never *below* `base`, a small or solo team
 * is held to exactly the standard it was held to before — this only asks more of evidence
 * that shows more work.
 *
 * The cap catches the case where `observed` is counted in a different unit than the thing
 * being asked for. Where the two units match — corrections against prompts — the rate is
 * inherently reachable, because asking for one correction per twenty prompts can always be
 * met by correcting once every twenty prompts. Where they do not — test *files* against
 * source *files* — a large enough codebase would demand a suite nobody could write in two
 * days, so those callers pass a tighter cap. A threshold nobody can reach is not a
 * standard, it is a zero with extra steps.
 */
export function scaledThreshold(base, observed, perUnit, cap = 10) {
  if (!Number.isFinite(observed) || observed <= 0) return base;
  return Math.min(Math.max(base, Math.ceil(observed / perUnit)), base * cap);
}

/**
 * Apply a facilitator's judgement to a criterion, if one was supplied and is well-formed.
 * Returns null when there is nothing usable to apply — the caller then falls back to its
 * own deterministic heuristic, which is what keeps `vibecheck` useful all day in practice
 * mode, long before any facilitator has judged anything.
 *
 * A judgement is trusted data by the time it reaches this function — the defence against
 * a team manipulating the *content* being judged lives entirely in the judging skill's
 * prompt design, where repo and transcript text enters as a quoted data envelope and never
 * as instructions. Nothing sits behind that: the injection scan used to zero a score
 * regardless of any judgement, and no longer touches one. This function validates the
 * judgement's *shape* only.
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
  const evidence = 'facilitator judging pass' + model + ': ' + justification;
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
        points: 7,
        lookedFor: "Whether your prompts show you steering the work across many turns, rather than one large ask and whatever came back.",
        evaluate(ev, { judgement } = {}) {
          // A facilitator's read of the actual goal-decomposition quality in the prompts, when
          // available, replaces this heuristic proxy rather than sitting alongside it.
          const judged = applyJudgement(judgement, 'iterative-direction', 7);
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
              'Only ' + t.userPrompts + ' prompt(s) recorded. A whole build in a couple of '
              + 'instructions leaves the design decisions with the agent; breaking the work '
              + 'into goals you can check one at a time puts them back with you.');
          }
          if (ratio > 80) {
            return partial(4, evidence,
              'The agent averaged ' + ratio.toFixed(0) + ' actions per instruction — long '
              + 'unsupervised stretches. Step in more often to check direction before it '
              + 'compounds.');
          }
          return pass(7, evidence);
        },
      },
      {
        id: 'prompts-carry-context',
        label: 'Prompts carried enough context to act on',
        points: 5,
        lookedFor: "The average length of your prompts, as a rough stand-in for how much context they carried. Both extremes cost points: a few words leaves the agent guessing, and a full specification every turn buries the actual ask.",
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
              'Prompts averaged ' + mean + ' characters. The agent has none of the context '
              + 'in your head, so naming the goal and the constraint in the prompt is what '
              + 'gets a usable answer the first time.');
          }
          if (mean > 6000) {
            return partial(3, evidence,
              'Prompts averaged ' + mean + ' characters. A full specification each turn buries '
              + 'the actual ask — durable context belongs in AGENTS.md, which leaves the '
              + 'prompt to carry just the goal.');
          }
          return pass(5, evidence);
        },
      },
      {
        id: 'course-correction',
        label: 'Read the output and corrected course',
        points: 5,
        lookedFor: "How many of your turns pushed back on what the agent had just produced, as a share of how much you asked for.",
        evaluate(ev) {
          if (chatMissing(ev)) return unharvested('no readable chat transcripts');
          const { corrections, userPrompts } = ev.chat.totals;
          // Scaled: two corrections is real steering across forty prompts and barely a
          // gesture across four hundred, and the second is what a team of five over two
          // days produces. See scaledThreshold.
          const wanted = scaledThreshold(2, userPrompts, 20);
          const evidence = corrections + ' correcting turn(s) out of ' + userPrompts
            + ' prompts (' + wanted + ' expected at this volume)';
          if (corrections >= wanted) return pass(5, evidence);
          if (corrections >= Math.ceil(wanted / 2)) {
            return partial(3, evidence,
              corrections + ' correcting turn(s) across ' + userPrompts + ' prompts. Some '
              + 'steering is visible, but at this volume of work more of it would be '
              + 'expected — pushing back on an answer that is not quite right is usually '
              + 'where the design actually gets settled.');
          }
          if (corrections > 0) {
            return partial(1, evidence,
              corrections + ' correcting turn(s) across ' + userPrompts + ' prompts. That '
              + 'is either a remarkably smooth run or a sign the output was going through '
              + 'unread — worth knowing which.');
          }
          return fail(evidence,
            'No correcting turn was recorded. Over a whole build, pushing back on an answer '
            + 'that is not quite right is usually where the design actually gets settled.');
        },
      },
      {
        id: 'planned-before-building',
        label: 'Planned before building',
        points: 4,
        lookedFor: "How many planning signals appear in your transcripts — plan mode, todo lists, planner skills — and how many journal entries you wrote. Their timing against your commits is not measured.",
        evaluate(ev) {
          const planUses = ev.noChatEvidence ? 0 : (ev.chat.totals.planningSignals ?? 0);
          const journalled = ev.journalEvidence?.substantiveEntries ?? 0;
          const evidence = 'planning signals (plan mode, todo lists, planner skills): '
            + planUses + ', journal entries: ' + journalled;
          const wanted = scaledThreshold(1, ev.noChatEvidence ? 0 : ev.chat.totals.userPrompts, 40);
          if (planUses >= wanted && journalled >= 1) return pass(4, evidence);
          if (planUses >= 1 || journalled >= 1) {
            return partial(2, evidence,
              'Some planning is visible, but not consistently. Agreeing an approach before '
              + 'code is where you make the decisions instead of reviewing them afterwards.');
          }
          if (chatMissing(ev) && journalled === 0) {
            return unharvested('no readable chat transcripts and no journal entries');
          }
          return fail(evidence,
            'No planning step is visible — no plan mode, no todo list, no journal entry. '
            + 'Agreeing an approach before code is what makes the decisions yours to make '
            + 'rather than yours to review afterwards.');
        },
      },
      {
        id: 'end-to-end-trace',
        label: 'At least one piece of work is traceable end to end',
        points: 4,
        lookedFor: "Whether any single session carries the whole loop: a goal set, the agent doing the work, the result actually verified, and you stepping back in to correct or confirm it.",
        evaluate(ev) {
          const traced = ev.noChatEvidence ? 0 : (ev.chat.totals.tracedSessions ?? 0);
          const sessions = ev.noChatEvidence ? 0 : (ev.chat.totals.sessionCount ?? 0);
          // A journal entry is the fallback for a tool this kit cannot read, and earns
          // less than a transcript on purpose: a team writes it about itself, so it can
          // never be worth as much as the record of what actually happened.
          const journalled = ev.journalEvidence?.substantiveEntries ?? 0;
          const evidence = traced + ' of ' + sessions + ' session(s) carried goal, work, '
            + 'verification and human review, journal entries: ' + journalled;

          if (traced >= 2) return pass(4, evidence);
          if (traced === 1) {
            return partial(3, evidence,
              'One session shows the whole loop. Doing it once proves you can; doing it for '
              + 'each piece of work is what makes the result trustworthy rather than lucky.');
          }
          if (journalled >= 1) {
            return partial(2, evidence,
              'No session shows the full loop, but the journal describes the work. A written '
              + 'account is worth less than the record of what happened — running the tests '
              + 'inside the session where you made the change lets the transcript show it '
              + 'for you.');
          }
          if (chatMissing(ev)) {
            return unharvested('no readable chat transcripts and no journal entries');
          }
          return fail(evidence,
            'No single session carries a goal through to a verified, reviewed result. The '
            + 'pieces may all be there across the day, but nothing ties one requirement to '
            + 'the change that met it and the test that proved it.');
        },
      },
    ],
  },

  {
    id: 'verification-loop',
    label: 'Verification Loop',
    points: 20,
    measuredBy: 'your transcripts and your test suite',
    criteria: [
      {
        id: 'tests-exist',
        label: 'Automated tests exist',
        points: 4,
        lookedFor: "Whether the repository contains automated test files, in some proportion to how much code there is.",
        evaluate(ev) {
          const count = ev.repoEvidence?.tests?.testFileCount ?? 0;
          const sourceFiles = ev.repoEvidence?.tests?.sourceFileCount ?? 0;
          // Three test files is a real suite for a one-file script and a token gesture for
          // a hundred-file application, so what counts as enough follows the size of the
          // thing being tested. Never below three — see scaledThreshold.
          const wanted = scaledThreshold(3, sourceFiles, 30, 4);
          const evidence = count + ' test file(s) across ' + sourceFiles + ' source file(s), '
            + wanted + ' expected at this size';
          if (count >= wanted) return pass(4, evidence);
          if (count >= 1) {
            return partial(2, evidence,
              count + ' test file(s) for ' + sourceFiles + ' source file(s) — enough to prove '
              + 'the runner works, not enough to catch a regression. Cover the paths that '
              + 'would hurt most if they broke.');
          }
          return fail(evidence,
            'No test files found. Without them nothing distinguishes working code from code '
            + 'that merely looks right.');
        },
      },
      {
        id: 'suite-runs-green',
        label: 'The suite runs, and passes',
        points: 7,
        lookedFor: "Whether we could find a command that runs your tests, and whether it passed when we ran it.",
        evaluate(ev) {
          const run = ev.repoEvidence?.tests?.run ?? {};
          // Skipping the run is the operator's choice, not the team's failing. Scoring it
          // as "no test command" would punish a team for how the scorer was invoked.
          if (!run.ran && run.reason === 'skipped by flag') {
            return unharvested('the test suite was not run when this was scored — scoring '
              + 'pushed repositories never runs a team\u2019s code, and --no-run-tests skips it '
              + 'too; the transcripts still show whether the agent ran it');
          }
          if (!run.ran) {
            // Never contradict `agent-ran-tests`. One repo was credited 6/6 for running
            // its tests throughout the build and told, two rows later, that "an agent that
            // cannot run your tests cannot check its own work" — because the scorer could
            // not find the command, not because the team could not run it. When the
            // transcripts show a suite running, that is evidence the scorer is the one
            // that fell short, so this goes unassessed rather than scored as a failure.
            const seen = chatMissing(ev) ? 0 : (ev.chat.totals.testRuns?.total ?? 0);
            if (seen > 0) {
              return unharvested('your transcripts show tests running ' + seen + ' time(s), '
                + 'but no command in this repo names the suite in a way the scorer could '
                + 'find — tell a facilitator the command and these points get scored');
            }
            const files = ev.repoEvidence?.tests?.testFileCount ?? 0;
            if (files > 0) {
              return unharvested(files + ' test file(s) are here, but the scorer could not '
                + 'work out how to run them. Add a `test` script or Makefile target and '
                + 'this gets scored');
            }
            return fail(run.reason ?? 'no test command detected',
              'No runnable test command was found. A named command is what lets an agent '
              + 'check its own work instead of describing it.');
          }
          // Counts first, exit code second: "516 passed, 2 failed" is the same fact as
          // "exited 2" in a form a team can act on.
          const counts = ['passed', 'failed', 'skipped']
            .filter((k) => typeof run.summary?.[k] === 'number')
            .map((k) => run.summary[k] + ' ' + k);
          const evidence = '`' + run.command + '` '
            + (counts.length ? counts.join(', ') + ' — exited ' : 'exited ') + run.exitCode
            + (run.timedOut ? ' (timed out)' : '') + ' in ' + Math.round(run.durationMs / 1000) + 's';
          if (run.timedOut) {
            return partial(3, evidence,
              'The suite did not finish within the timeout. A suite nobody waits for is a '
              + 'suite nobody runs.');
          }
          if (run.exitCode === 0) return pass(7, evidence);
          // The suite never reached a test, so its exit code says nothing about the code.
          if (run.couldNotStart) {
            return unharvested('`' + run.command + '` could not start on this machine ('
              + run.couldNotStartWhy + '), so the run says nothing about your tests — '
              + 'these points are neither earned nor lost');
          }
          // Say how far off green it is. "Your suite is red" reads the same whether one
          // test fails or every one does, and those are not the same situation to be in.
          const failed = run.summary?.failed;
          const passed = run.summary?.passed;
          const shortfall = typeof failed === 'number' && typeof passed === 'number'
            ? failed + ' of ' + (failed + passed) + ' tests are failing. '
            : 'The suite runs but is red at hand-in. ';
          return partial(3, evidence, shortfall
            + 'Finishing on red means the last thing you built was never verified — and if '
            + 'those failures need a database or a running service, say so in your README '
            + 'so the next person knows.');
        },
      },
      {
        id: 'agent-ran-tests',
        label: 'Tests were run during the work, not just at the end',
        points: 5,
        lookedFor: "How often tests ran across your transcripts, relative to how much you asked the agent to do.",
        evaluate(ev) {
          if (chatMissing(ev)) return unharvested('no readable chat transcripts');
          const runs = ev.chat.totals.testRuns;
          const prompts = ev.chat.totals.userPrompts ?? 0;
          const wanted = scaledThreshold(5, prompts, 8);
          const evidence = runs.total + ' test run(s) in transcripts ('
            + runs.pass + ' pass, ' + runs.fail + ' fail), ' + wanted + ' expected across '
            + prompts + ' prompts';
          if (runs.total >= wanted) return pass(5, evidence);
          if (runs.total >= 1) {
            return partial(2, evidence,
              'Tests ran ' + runs.total + ' time(s) during the whole build. Running them '
              + 'after each change is what turns them into a feedback loop.');
          }
          return fail(evidence,
            'No test run appears in the transcripts. Running them after each change is what '
            + 'turns a claim that something works into evidence that it does.');
        },
      },
      {
        id: 'failures-were-closed',
        label: 'Failures were fixed and re-verified',
        points: 4,
        lookedFor: "Whether a failing test was followed by a fix and a passing re-run in the same session.",
        evaluate(ev) {
          if (chatMissing(ev)) return unharvested('no readable chat transcripts');
          const loops = ev.chat.totals.failThenPassSequences;
          const failures = ev.chat.totals.testRuns.fail;
          // Scaled against the failures themselves rather than against prompts: what
          // this criterion asks is "did you drive your failures back to green", and a team
          // whose suite rarely broke cannot be asked for loops it had no failures to make.
          // Debugging typically produces fail, fail, fail, pass — one loop for several
          // failures — so the rate is well below one-for-one on purpose.
          const wanted = scaledThreshold(2, failures, 3);
          const evidence = loops + ' fail-then-pass loop(s) across ' + failures
            + ' failing run(s), ' + wanted + ' expected at this volume';
          if (loops >= wanted) return pass(4, evidence);
          if (loops >= 1) {
            return partial(2, evidence, loops + ' failure(s) driven back to green. Good — do '
              + 'it every time, not only when it is quick.');
          }
          if (failures === 0) {
            return partial(2, evidence,
              'No failing test runs to recover from. Either the work was unusually smooth, or '
              + 'the tests are not exercising enough to fail.');
          }
          return fail(evidence,
            failures + ' failing run(s) with no recorded return to green in the same session. '
            + 'Driving a failure back to green before moving on is what keeps the next change '
            + 'from building on a broken one.');
        },
      },
    ],
  },

  {
    id: 'context-and-harness',
    label: 'Context & Understanding',
    points: 20,
    measuredBy: 'your repo and git timestamps',
    criteria: [
      {
        id: 'instruction-layer-exists',
        label: 'An instruction layer exists',
        points: 3,
        lookedFor: "Whether the repository has a file telling an agent how to work here — AGENTS.md, CLAUDE.md, .cursorrules or similar.",
        evaluate(ev) {
          const files = (ev.repoEvidence?.harnessFiles ?? []).filter((f) => f.present);
          const evidence = files.length
            ? files.map((f) => f.path
              + (typeof f.lines === 'number' ? ' (' + f.lines + ' lines)' : ' (unreadable)')).join(', ')
            : 'no AGENTS.md, CLAUDE.md or copilot-instructions.md';
          if (!files.length) {
            return fail(evidence,
              'No instruction file found. Without one, each session starts with the agent '
              + 'knowing only what your prompt tells it. A short AGENTS.md naming the stack, '
              + 'the commands and the rules is usually an hour well spent.');
          }
          const biggest = Math.max(...files.map((f) => f.lines ?? 0));
          if (biggest < 25) {
            // 1 of 3, as 2 of 5 was: a token instruction file stays below half.
            return partial(1, evidence,
              'The instruction layer is ' + biggest + ' lines — too thin to change how the '
              + 'agent behaves.');
          }
          return pass(3, evidence);
        },
      },
      {
        id: 'harness-is-substantive',
        label: 'It contains your project’s real rules, not template text',
        points: 5,
        lookedFor: "Whether that file states this project's real rules, or is still template text and unfilled placeholders.",
        evaluate(ev, { judgement } = {}) {
          const judged = applyJudgement(judgement, 'harness-is-substantive', 5);
          if (judged) return judged;
          const files = (ev.repoEvidence?.harnessFiles ?? []).filter((f) => f.present);
          if (!files.length) return fail('no instruction files', 'Nothing to assess — see above.');
          const placeholders = files.reduce((n, f) => n + (f.unfilledPlaceholders ?? 0), 0);
          const similarity = Math.max(...files.map((f) => f.templateSimilarity ?? 0));
          const evidence = placeholders + ' unfilled placeholder(s), highest template similarity '
            + similarity;
          if (placeholders === 0 && similarity < 0.5) return pass(5, evidence);
          if (placeholders > 0 && similarity >= 0.5) {
            return fail(evidence,
              'The instruction file is still largely the shipped template, with '
              + placeholders + ' placeholder(s) never filled in. Each placeholder is a '
              + 'question about your project the agent has to guess at — replacing them with '
              + 'your real commands and constraints is what makes the file earn its place.');
          }
          if (placeholders > 0) {
            return partial(2, evidence,
              placeholders + ' placeholder(s) were never filled in. Each one is a question '
              + 'about your project the agent had to guess at.');
          }
          return partial(2, evidence,
            'Most lines still match the template. The value is in the parts only your team '
            + 'could write.');
        },
      },
      {
        id: 'commands-documented',
        label: 'The commands an agent needs are discoverable',
        points: 3,
        lookedFor: "Whether setup, test, run, lint and build commands are discoverable from the repository itself — package.json, a Makefile, a justfile, or a language manifest.",
        evaluate(ev) {
          const commands = ev.repoEvidence?.commands ?? {};
          const named = ['setup', 'test', 'dev', 'start', 'lint', 'build']
            .filter((k) => commands[k]);
          // Cite the command and the file it came from. "none detected" told a team
          // nothing about what the scorer had looked for, and was wrong besides.
          const evidence = named.length
            ? named.map((k) => '`' + commands[k] + '`'
              + (commands[k + 'Source'] ? ' (' + commands[k + 'Source'] + ')' : '')).join(', ')
            : 'no setup, test, dev, start, lint or build command found in package.json, a '
              + 'Makefile, a justfile or a language manifest';
          if (named.length >= 3) return pass(3, evidence);
          if (named.length >= 1) {
            const list = named.length === 1
              ? 'a ' + named[0] + ' command is'
              : named.slice(0, -1).join(', ') + ' and ' + named.at(-1) + ' commands are';
            return partial(1, evidence,
              'Only ' + list + ' discoverable. An agent that cannot set up and run your '
              + 'project cannot check its own work.');
          }
          return fail(evidence,
            'No setup, run or test command is discoverable from the repo. A `scripts` block '
            + 'in package.json, or a Makefile target, is enough — it is what lets an agent '
            + 'check its own work instead of describing it.');
        },
      },
      {
        id: 'harness-preceded-code',
        label: 'The harness existed before the bulk of the code',
        points: 3,
        lookedFor: "When your instruction files first appeared in git history, relative to the bulk of your commits.",
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
          if (early.length) return pass(3, evidence);
          // A squashed or single-commit repo has no ordering to read: every file lands in
          // the same commit, so every harness file shows zero commits after it. Reading
          // that as "written at the end" tells a team something false with total
          // confidence — and squashing before hand-in is a normal thing to do.
          const commits = ev.gitEvidence?.commitCount ?? 0;
          if (commits < 5) {
            return unharvested('this repo has ' + commits + ' commit(s), so there is no '
              + 'ordering to read — a squashed history says nothing either way about when '
              + 'the harness was written');
          }
          const most = Math.max(...timing.map((t) => t.commitsAfterItAppeared ?? 0));
          if (most >= 3) {
            return partial(1, evidence, 'The harness arrived after some of the code, but was '
              + 'still in place for the rest of it. Writing it before the first feature is '
              + 'what makes it steer the work rather than record it.');
          }
          return fail(evidence,
            'The harness first appears in git history after essentially all of the code. A '
            + 'harness written up front steers the work; one written afterwards can only '
            + 'describe it. Next time, commit it before the first feature.');
        },
      },
      {
        id: 'domain-context-captured',
        label: 'The problem the software solves is written down',
        points: 6,
        lookedFor: "Whether the repository records what this project is for and the rules of its domain — a project-context, business-context or architecture document an agent can read before it changes anything.",
        evaluate(ev, { judgement } = {}) {
          const judged = applyJudgement(judgement, 'domain-context-captured', 6);
          if (judged) return judged;
          const docs = (ev.repoEvidence?.contextDocs ?? []).filter((d) => d.present);
          if (!docs.length) {
            return fail('no docs/project-context.md, business-context.md or architecture.md',
              'Nothing in the repository says what this project is for. The rules of the '
              + 'domain — what a booking is, what must never happen, which decisions are '
              + 'already settled — exist only in your heads, so every session starts with '
              + 'the agent guessing at them and every teammate re-derives them. One page '
              + 'naming the problem and its rules is usually the highest-value hour of the '
              + 'day.');
          }
          const lines = docs.reduce((n, d) => n + (d.lines ?? 0), 0);
          const placeholders = docs.reduce((n, d) => n + (d.unfilledPlaceholders ?? 0), 0);
          const similarity = Math.max(...docs.map((d) => d.templateSimilarity ?? 0));
          const evidence = docs.map((d) => d.path + ' (' + (d.lines ?? 0) + ' lines)').join(', ')
            + ', ' + placeholders + ' unfilled placeholder(s), highest template similarity '
            + similarity;

          if (lines < 20) {
            return partial(2, evidence,
              'The context document is ' + lines + ' lines — a heading and little else. What '
              + 'the product is, who uses it and the two or three rules that must never be '
              + 'broken is enough to change how every session starts.');
          }
          if (placeholders > 0) {
            return partial(3, evidence,
              placeholders + ' placeholder(s) were never filled in. Each one is a question '
              + 'about your domain the agent had to guess at.');
          }
          if (similarity >= 0.5) {
            return partial(3, evidence,
              'Most of it still matches the template. The value is in the parts only your '
              + 'team could write — the rules of this problem, not the shape of the file.');
          }
          return pass(6, evidence);
        },
      },
    ],
  },

  {
    id: 'safety-and-boundaries',
    label: 'Safety, Privacy & Boundaries',
    points: 10,
    measuredBy: 'your repo',
    criteria: [
      {
        id: 'no-secrets',
        label: 'No secrets in tracked files',
        points: 4,
        lookedFor: "Whether tracked files contain anything shaped like a real credential. Locations only — the value is never recorded.",
        evaluate(ev) {
          const findings = ev.repoEvidence?.safety?.secretFindings;
          const count = findings?.offered ?? 0;
          // A clean result from an incomplete scan is not a clean result. The file walk
          // stops at its cap on very large repos, and awarding full marks off a partial
          // sweep would be exactly the silent pass this kit tells teams to avoid.
          if (count === 0 && ev.repoEvidence?.source?.truncated) {
            return unharvested('the file scan hit its limit before finishing, so "no secrets '
              + 'found" cannot be trusted — a facilitator should re-run it on a narrower path');
          }
          // Credentials that only ever pointed at localhost are collected separately and
          // deliberately not counted. Eight `postgresql://…@localhost:5432/…` lines in
          // local-only dev scripts cost one repo five points and told it to "rotate
          // anything real" — a scary instruction about a password that unlocks nothing.
          const local = ev.repoEvidence?.safety?.localCredentials?.offered ?? 0;
          const untracked = ev.repoEvidence?.safety?.untrackedCredentials?.offered ?? 0;
          const localNote = [
            local ? local + ' local-only dev credential(s)' : null,
            untracked ? untracked + ' in file(s) git does not track' : null,
          ].filter(Boolean);
          const note = localNote.length
            ? ' (' + localNote.join(', ') + ' — seen, not counted)' : '';
          if (count === 0) return pass(4, 'no secret patterns matched in tracked files' + note);
          const where = (findings.kept ?? []).slice(0, 3)
            .map((f) => f.file + ':' + f.line).join(', ');
          return fail(count + ' finding(s): ' + where + note,
            count + ' possible secret(s) committed. Rotate anything real, move it to an '
            + 'environment variable, and remember that deleting it from the working tree '
            + 'does not remove it from git history.');
        },
      },
      {
        id: 'env-handling',
        label: 'Environment files handled properly',
        points: 2,
        lookedFor: "Whether .env files are covered by .gitignore, and whether one was committed.",
        evaluate(ev) {
          const safety = ev.repoEvidence?.safety ?? {};
          const tracked = ev.gitEvidence?.trackedEnvFiles ?? [];
          const evidence = '.gitignore covers .env: ' + !!safety.gitignoreCoversEnv
            + ', tracked env files: ' + tracked.length;
          if (tracked.length) {
            return fail(evidence, 'An environment file is committed: ' + tracked.join(', ')
              + '. Remove it from tracking, add it to .gitignore, and rotate anything real '
              + 'that was in it — deleting the file does not remove it from git history.');
          }
          if (!safety.gitignorePresent) {
            return fail(evidence, 'No .gitignore, so nothing stops a secret being committed by accident.');
          }
          if (!safety.gitignoreCoversEnv) {
            return partial(1, evidence, '.gitignore does not cover .env files. One line now '
              + 'prevents the accident later.');
          }
          return pass(2, evidence);
        },
      },
      {
        id: 'deliberate-boundaries',
        label: 'Boundaries were a decision, not a default',
        points: 2,
        lookedFor: "Whether a permission policy is committed to the repo, and how many destructive commands were run without one.",
        evaluate(ev) {
          const settings = ev.repoEvidence?.safety?.claudeSettingsPresent;
          const destructive = ev.noChatEvidence ? null : ev.chat.totals.commands.destructive;
          const evidence = 'permission settings committed: ' + !!settings
            + (destructive === null ? '' : ', destructive commands run: ' + destructive);
          if (settings) return pass(2, evidence);
          // 1 of 2, not 2 of 2. This branch kept its literal when the criterion dropped
          // from 3 points to 2, which handed a team with no readable transcripts and no
          // permission policy the same full marks as a team that provably ran nothing
          // destructive — and made a "partial" outcome equal to its own maximum.
          if (destructive === null) {
            return partial(1, evidence,
              'No committed permission settings, and no transcripts to judge command '
              + 'hygiene from.');
          }
          if (destructive === 0) return pass(2, evidence);
          if (destructive <= 4) {
            return partial(1, evidence,
              destructive + ' destructive command(s) run with no committed permission policy. '
              + 'Deciding up front what an agent may do without asking is quicker than '
              + 'reviewing each request, and it survives into the next session.');
          }
          // `fail`, not `partial(0)`: a partial that earns nothing is indistinguishable
          // from a failure on the report while claiming to be something else.
          return fail(evidence,
            destructive + ' destructive commands and no permission policy. Decide up front '
            + 'what an agent may do without asking.');
        },
      },
      {
        id: 'privacy-of-sample-data',
        label: 'Sample data is invented, not real',
        points: 2,
        facilitatorScored: true,
        lookedFor: "A facilitator confirms your seed and test data is invented, and that no real personal data from anyone's employer, client or contacts was used to build it.",
        evaluate(ev, { facilitatorScorecard } = {}) {
          // Deliberately never scanned for. Detecting "real personal data" means pattern
          // matching names, emails and phone numbers in a team's fixtures, and that scan
          // is wrong far more often than it is right — an invented `ana@example.com` and a
          // real colleague's address are the same string shape. This kit already learned
          // what a misfiring regex costs when it accused ten teams of hiding instructions
          // in an emoji, and a false accusation of leaking someone's personal data is a
          // worse version of that mistake. A person looks, and a person decides.
          const entry = facilitatorScorecard?.privacy;
          if (!entry || typeof entry.met !== 'boolean') {
            return unharvested('awaiting a facilitator’s check of your sample data');
          }
          const evidence = 'facilitator check: ' + (entry.met ? 'invented data' : 'concern raised')
            + (entry.note ? ' — ' + entry.note : '');
          return entry.met ? pass(2, evidence)
            : fail(evidence, entry.note ?? 'Real personal data was used to build or seed the '
              + 'prototype. Replace it with invented records and remove it from git history.');
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
        lookedFor: "Whether a README exists and says enough for someone new to understand what this is.",
        evaluate(ev) {
          const repro = ev.repoEvidence?.reproducibility ?? {};
          const evidence = repro.readmePresent ? repro.readmeBytes + ' bytes' : 'no README.md';
          if (!repro.readmePresent) return fail(evidence, 'No README. Someone arriving cold has nowhere to start.');
          if (repro.readmeBytes < 400) {
            return partial(1, evidence,
              'The README is ' + repro.readmeBytes + ' bytes — a title and little else. What '
              + 'it is, how to run it, and how to test it is enough.');
          }
          return pass(3, evidence);
        },
      },
      {
        id: 'setup-documented',
        label: 'Setup works from a fresh clone',
        points: 4,
        lookedFor: "Whether someone with a fresh clone could get this running — a setup command, a run command, or a container config.",
        evaluate(ev) {
          const repro = ev.repoEvidence?.reproducibility ?? {};
          const evidence = 'setup command: ' + (repro.setupCommand ?? 'none')
            + ', run command: ' + (repro.runCommand ?? 'none')
            + ', container config: ' + (repro.containerFile ?? 'none');
          if (repro.setupCommand || repro.containerised) return pass(4, evidence);
          if (repro.runCommand) {
            return partial(2, evidence,
              'There is a run command but no setup step, so a newcomer has to work out the '
              + 'prerequisites themselves.');
          }
          return fail(evidence,
            'Neither a setup nor a run command is discoverable, so getting this running '
            + 'somewhere new means reading the source to work out how. A setup script, a '
            + 'documented command, or a compose file each solve it.');
        },
      },
      {
        id: 'dependencies-pinned',
        label: 'Dependencies are pinned',
        points: 3,
        lookedFor: "Whether a lockfile or pinned manifest is committed, so the same versions install twice.",
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
    points: 15,
    measuredBy: 'a facilitator, watching your demo',
    criteria: [
      {
        id: 'demo',
        label: 'The use case runs and does what it claims',
        points: 10,
        lookedFor: "A facilitator watching your demo decides whether the use case runs and does what you said it would.",
        evaluate(ev, { facilitatorScorecard } = {}) {
          const entry = facilitatorScorecard?.demo;
          if (!entry || typeof entry.points !== 'number') {
            return unharvested('awaiting a facilitator’s demo score');
          }
          const capped = Math.max(0, Math.min(10, entry.points));
          const evidence = 'facilitator score ' + capped + '/10'
            + (entry.note ? ' — ' + entry.note : '');
          if (capped === 10) return pass(10, evidence);
          if (capped === 0) return fail(evidence, entry.note ?? 'The demo did not work.');
          return partial(capped, evidence, entry.note ?? 'Partially working at demo time.');
        },
      },
      {
        id: 'acceptance-checklist',
        label: 'The scenario the brief asked for actually runs',
        points: 5,
        facilitatorScored: true,
        lookedFor: "How many steps of this event's acceptance checklist a facilitator saw working during your demo.",
        evaluate(ev, { facilitatorScorecard } = {}) {
          // The checklist is supplied per event, never built into the kit: what "it works"
          // means is a property of the brief a team was given, and a rubric that hardcodes
          // one event's scenario stops being usable at the next one.
          const items = facilitatorScorecard?.acceptance;
          if (!Array.isArray(items) || !items.length) {
            return unharvested('no acceptance checklist was recorded for this event — see '
              + 'docs/acceptance-checklist.template.json');
          }
          const met = items.filter((i) => i?.met === true).length;
          // Named rather than inlined: written as one expression this read `a + b || c`,
          // and because `+` binds tighter than `||` the whole concatenation was the left
          // operand — always truthy, so the all-met wording was unreachable and a team
          // with a clean sweep was shown a dangling colon.
          const unmet = items.filter((i) => i?.met !== true)
            .map((i) => i?.id ?? i?.label).filter(Boolean);
          const evidence = unmet.length
            ? met + ' of ' + items.length + ' checklist step(s) seen working; not seen: '
              + unmet.slice(0, 4).join(', ') + (unmet.length > 4 ? ', and more' : '')
            : met + ' of ' + items.length + ' checklist step(s) seen working, all of them';
          const earned = Math.round((met / items.length) * 5);
          if (met === items.length) return pass(5, evidence);
          if (earned <= 0) {
            return fail(evidence, 'None of the checklist steps ran. Whatever else was built, '
              + 'the flow the brief asked you to prove is not working yet.');
          }
          return partial(earned, evidence,
            (items.length - met) + ' checklist step(s) did not run. A small flow that works '
            + 'end to end is worth more than a broad one that stops halfway.');
        },
      },
    ],
  },
];
