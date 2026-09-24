# harness-kit

A workshop kit for learning to build software *with* AI — and a scorer that tells you how
well you did it.

Teams get harness templates and the scoring rubric on day one. At the end, one command
turns their repo, their git history and their AI chat transcripts into a score out of 100,
listing every criterion — passed and failed alike — with what was looked for, what was
found, and what to do about it.

## First, the thing that confuses everyone

**This repository is not where teams work.** It is a tool they point *at* their own
project. A team builds their booking app, or whatever the brief asks for, in their own
repository; the kit is cloned once, separately, and run against it:

```bash
git clone https://github.com/urmiZuhlke/harness-kit.git    # once, anywhere
cd ~/my-team/booking-app                                    # your own project
node ~/harness-kit/bin/vibecheck.mjs
```

Handing in does not even need the clone — one downloaded file, below. Nothing is installed and there are no dependencies — Node 20+ (22.5+ to read Cursor
history) and that is all.

## How the 100 points are decided

| Decided by | Points | What it means |
| ---------- | -----: | ------------- |
| **A plain script** | **65** | Counting. No AI anywhere. The same evidence always gives the same number, and anyone can re-run it and get it again. |
| **An AI judging pass** | **18** | Three things counting cannot settle: is the harness real, did the prompts show real decomposition, is the problem written down. A facilitator runs this once per team. **Skip it and every team keeps an automatic fallback instead** — the kit works with no AI at all. |
| **A person watching** | **17** | The demo (10), this event's acceptance checklist (5), and a look at whether the seed data is invented (2). A facilitator writes these into one small file per team. |

Two-thirds of the score is not a matter of opinion. Teams can run the script part on
themselves as often as they like, all day; the other 35 points wait for a facilitator and
are clearly marked "not scored yet" until then.

## The process, end to end

**At hand-in — every team member, once, on the laptop they worked on.** One downloaded file,
run from the project folder:

```bash
curl -fsSLo ~/collect-history.mjs https://raw.githubusercontent.com/urmiZuhlke/harness-kit/main/dist/collect-history.mjs
node ~/collect-history.mjs
```

No kit clone and no team name — the repository is the team. It reads that person's AI chat
history for this project and writes `.vibecheck/history-<name>.json`, which they commit and
push with their work. AI chat history lives in each person's home directory, so a member
who skips this is invisible to the score; the leaderboard names teams with missing files.
The file holds counts and short, secret-redacted prompt snippets — never a conversation —
and `node collect-history.mjs --help` lists exactly what.

**Afterwards — a facilitator:** clone every team's repository into one folder (folder name
= team name) and run one command:

```bash
node bin/leaderboard.mjs --repos repos --html leaderboard.html
```

Each repository and its git history are read, each member's history file is merged in, and
every score is computed there — so a team editing their own `score.json` changes nothing.
**No team code is executed**, so twenty repos take seconds on any laptop with Node and
none of the teams' toolchains.

**During the event, optionally:** teams who clone the kit can run the full self-check,
`node ~/harness-kit/bin/vibecheck.mjs`, as often as they like. It writes
`.vibecheck/report.html` — their score and what to do next — and it also runs their test
suite. (The older hand-in flow, `vibecheck --team "Name"` on each laptop and
`leaderboard --dir collected`, still works.)

## For teams

**1. Read the rubric.** [`docs/rubric.md`](docs/rubric.md) — six dimensions, 100 points,
published up front. Nothing is hidden.

**2. Build your harness.** Templates to start from live in
[`02-agentic-preparation/templates/`](02-agentic-preparation/templates/):

- `AGENTS.md` / `CLAUDE.md` / `copilot-instructions.md` — the instruction layer: how to
  work in this repo
- `project-context.md` — the problem itself: the domain, its rules, your decisions. Save
  it as `docs/project-context.md`; it is scored separately from the instruction layer,
  because an agent cannot infer any of it from your source
- `instructions/` — path-scoped rules, for where they earn their place
- `story-template.md` — a structure for the work you hand an agent

They are starting points, not answers. An unmodified template scores close to zero —
the rubric rewards *your* project's real rules, commands and constraints.

**3. Check yourself, as often as you like.** From your own project directory:

```bash
node ~/harness-kit/bin/vibecheck.mjs
```

It reads your repo, your git history and your AI chat transcripts — locally — and writes
`.vibecheck/report.html` with your score and what to do next, ranked by what it is worth.

**4. Hand in.** Every member runs `collect-history.mjs` once and pushes what it writes —
see "The process, end to end" above.

Transcripts can be read from **Claude Code (CLI, VS Code or JetBrains extension, or the Code tab in Claude Desktop), Codex (CLI, desktop app or VS Code extension), GitHub Copilot in VS Code, and Cursor**. Browser chats (ChatGPT, claude.ai,
Codex on the web) cannot. Anything else is reported as unassessed rather than failed — run `/journal` at
milestones as your fallback.

## For facilitators

- [`docs/rubric.md`](docs/rubric.md) — the shared standard every team is scored against
- [`docs/facilitator-field-guide.md`](docs/facilitator-field-guide.md) — one page: the
  intervention ladder, the cadence, and the three things to do before the event starts
- [`docs/participant-one-pager.md`](docs/participant-one-pager.md) — what teams are told,
  including the privacy notice they consent to
- [`docs/acceptance-checklist.template.json`](docs/acceptance-checklist.template.json) —
  write this from your event's brief; it is 5 of the 100 points
- [`docs/intro-outline.md`](docs/intro-outline.md) — a 30-minute kickoff outline
- Leaderboard across every team. Clone every team's repository into one folder and run:

```bash
node bin/leaderboard.mjs --repos repos --html leaderboard.html
```

Each clone is one team, named after its folder; every member's committed history file is
merged into it, and no team code is run. Your own per-team files go in the same folder as
the clones, as `<team-slug>.scorecard.json` and `<team-slug>.judgement.json`.

The run also writes `repos/judging/<team>.json` — one small file per team holding only
the excerpts `/facilitator-judge` reads. Judge from those: they leave out the committer
names, repository paths, branch names and test output that a judgement does not depend on.

## What this measures

Engineering leverage, not consumption. Token counts, lines of code, commit numbers and
team size are not inputs to the score. What carries weight is evidence that is expensive
to fake: a real plan-implement-test-fix loop in your transcripts, a harness that existed
before the code, a written account of the problem being solved, and tests that actually
run.

## Requirements

Node 20 or newer, and nothing to install — the tests use Node's built-in runner. Reading
Cursor's history needs Node 22.5 or newer, because it uses `node:sqlite`; on an older
runtime that one source reports as unreadable and nothing else changes.

## Optional: install the agent roster globally

The kit ships four generic agents — Planner, Implementer, Reviewer, Explore — plus the
`harness-kit` scaffolding skill. Installing them makes them available from any repo:

```bash
node plugin/scripts/install.mjs --dry-run
```

Preview first; drop `--dry-run` to apply. Plain Node, no build step, safe to re-run.

## Layout

See [`docs/repo-structure.md`](docs/repo-structure.md). Work in progress is tracked in
[`docs/stories/`](docs/stories/).
