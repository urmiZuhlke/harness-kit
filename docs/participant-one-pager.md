# Participant one-pager

## What you're building

A working use case, built *with* an AI coding agent, inside the time the event gives you —
anything from half a day to two. Finishing the use case is necessary but not sufficient:
how you got there is worth as much as what you shipped.

## How you're scored

**100 points, six dimensions.** Nothing below is hidden or added later — this is the
whole rubric, and you're free to optimise for it. It's weighted so the only way to score
well is to actually work well.

| # | Dimension | Points | Measured from |
| - | --------- | -----: | -------------- |
| 1 | Working Method | 25 | your AI chat transcripts |
| 2 | Verification Loop | 20 | your transcripts + your test suite |
| 3 | Context & Understanding | 20 | your repo + git timestamps |
| 4 | Safety, Privacy & Boundaries | 10 | your repo, plus one facilitator check |
| 5 | Reproducibility & Handover | 10 | your repo |
| 6 | It Actually Works | 15 | a facilitator, watching your demo |

Full detail on what earns points in each — [`docs/rubric.md`](rubric.md).

**What doesn't count:** token volume, lines of code, commit count, hours logged, how many
people are on your team. We're measuring engineering leverage, not consumption. Where a
criterion counts something — corrections, test runs — the bar rises with how much work
your evidence shows, and never falls below what one person's day is held to.

## How the score is produced

**It is a plain script, not an AI.** It reads files, counts things and writes a report. No
agent, no chatbot, no prompt — the same input always gives the same number. Run it in a
terminal as often as you like:

```bash
node bin/vibecheck.mjs
```

This reads your repo, your git history, and your AI chat transcripts — **on your own
machine, locally** — and writes `.vibecheck/report.html`: your score, what you did well,
what to do next ranked by what it's worth, and then all 23 criteria in full. Each one tells
you the same three things — what we looked for, what we found, and what to do about it —
whether you scored full marks on it or nothing at all.

This is **practice mode**. The criteria a facilitator settles — your demo, the acceptance
checklist, the sample-data check — stay unscored until they do. Everything else is real,
live, and yours to act on all day.

**Run it early**, not just before hand-in. It costs you nothing and tells you exactly
what's worth doing next while you still have time to do it.

Practice mode needs a clone of the kit. **Handing in does not** — see the next section.
Facilitators recompute every score themselves from your pushed repository, so editing your
own `score.json` changes nothing.

## Handing in — every team member runs one file

Your AI chat history lives in *your own* home directory, not in the repo. Nobody can see
how your team worked unless each of you hands it in, and a team where one person does is
scored on one person's work.

So before the deadline, **every member** does this once, on the laptop they worked on:

1. **Download `collect-history.mjs`** from the link your facilitators share. Save it
   anywhere — your Downloads folder is fine. Keep the `.mjs` ending; if your browser
   renamed it (to `.txt`, or `collect-history (1).mjs`), use whatever name it has.
2. **Open a terminal in your project folder** and run it:

```bash
# macOS / Linux
cd ~/path/to/your-project
node ~/Downloads/collect-history.mjs
```

```powershell
# Windows (PowerShell)
cd C:\path\to\your-project
node $HOME\Downloads\collect-history.mjs
```

It is one self-contained file, it needs Node 20 or newer and nothing else, and it takes a
few seconds. It writes **`.vibecheck/history-<your name>.json`** into your project and
prints the three git commands to commit and push it. Push it with your work; facilitators
pull your repository and read it from there. There is no team name to type — your
repository *is* your team — and each person's file has their own name, so teammates never
conflict.

Run it **from the folder you opened in your AI tool** — sessions are matched by folder. If
it finds nothing, it says why. Run it once mid-way too, not only at the deadline: it is how
you find out early that someone's tool can't be read, which is a five-minute problem on
day one and an unfixable one at the deadline.

**Transcripts can be read from:** Claude Code (CLI, VS Code or JetBrains extension, or the Code tab in Claude Desktop), Codex (CLI, desktop app or VS Code extension), GitHub Copilot in VS Code, and Cursor. Browser chats (ChatGPT, claude.ai,
Codex on the web) cannot. Using something else costs you nothing directly — those criteria come back
"unassessed" rather than failed, and ranking uses your share of assessable points — but
you get no feedback on them either, so run `/journal` at milestones. It's your fallback,
and it's a good habit regardless.

*(Reading Cursor's history needs Node 22.5 or newer. On an older Node it says so rather
than silently finding nothing.)*

## Privacy — what's actually read, and where it goes

### The history file you hand in

`collect-history.mjs` reads your AI chat history **locally** and writes one file,
`.vibecheck/history-<your name>.json`. **You commit and push it, so it goes wherever your
repository goes** — visible to your teammates, the facilitators, and anyone else who can
see the repository. If your repository is public, so is this file. Open it and read it
before you commit it.

- **In it:** your name (from git `user.name`, or your computer's username); the name of
  your project folder; and, for each chat session in this project, its ID, when it
  started and ended, branch names, how many prompts you wrote and how long they were, which tools the
  agent called and how often, how many commands it ran and of what kind (test, build,
  destructive), whether each test run passed or failed, how many times you corrected it,
  and whether you used a planning step.
- **Also in it:** a few of your prompts, cut to 280 characters — the first 6 per session,
  plus up to 6 where you corrected the agent — so a facilitator can see *how* you asked
  for things. Anything that looks like a key, token or password is replaced by
  `[redacted: …]` before it is written. Anything else you typed into those first 280
  characters is in there as you typed it.
- **Never in it:** full conversations, the agent's replies, your source code, the path to
  your project on your laptop, or anything from sessions in other folders.
- **Nothing is uploaded by the script.** The only way the file leaves your laptop is you
  pushing it.

On the facilitator's side, your pushed repository and its git history are read — including
the names on your commits, which your repository already shows — and your code is **not
run**. What they produce from it is described below.

### The self-check (`vibecheck`)

If you run the practice check, `vibecheck` reads your AI chat transcripts **locally** to
score how you worked:

- **Read:** message counts, prompt lengths, which tools got called, whether tests were
  run and whether they passed, commit timestamps.
- **Extracted into `.vibecheck/evidence.json`:** short excerpts (under 300 characters) of
  a handful of prompts, so a facilitator can see *how* you asked for things — never a full
  transcript. Plus the first ~4,000 characters of your harness and context files
  (`AGENTS.md`, `docs/project-context.md` and friends), with anything that looks like a
  credential automatically replaced by `[redacted]` before it's written.
- **Also recorded:** the file and line of anything that looks like a credential —
  locations only, never the value itself; the names on your commits; the path to your repo
  on this machine and your branch names; the names of the tools your agent called; and up
  to 4,000 characters of whatever your test command last printed, with credential-shaped
  strings replaced by `[redacted]`.
- **Your team name and who ran the check**, from `--team` and your git `user.name`, if you
  used the older hand-in file instead of the history file above. On a
  merged team bundle this becomes a per-member breakdown: who contributed, from which repo
  path on their own machine, when, and how many sessions and prompts each. That is the
  audit trail for a merged score, and it is visible to anyone who opens the file.
- **About that test output:** a failing suite often prints file paths and the lines of code
  around the failure, so we can't promise no source code ever appears there. Read it
  yourself in `evidence.json` if that matters to you.
- **Never copied:** full conversations, your source files wholesale, anything from outside
  the repo you're scoring.

`evidence.json` is yours — open it and read exactly what was collected about you.

### The judging pass

**One more thing leaves the facilitators' machine.** Three of the 100 points' worth of
criteria — is your harness substantive, did your prompts show real decomposition, do your
context documents record the real problem — cannot be settled by counting, so a
facilitator judges them with an AI model. Under the kit's own rubric, that is the only step where anything about you
reaches a model, and it sends a **separate, trimmed file**, not your evidence:

- **Sent:** your harness and context file excerpts (credentials already redacted), your
  prompt excerpts, your team name, your repository's *name*, and three counts — how many
  prompts, sessions and people the excerpts are drawn from.
- **Not sent:** the names on your commits, the path to the repository on anyone's laptop,
  your branch names, your test output, the locations of anything credential-shaped, the
  names of the tools your agent called, and the per-member breakdown.

The facilitator's own command writes that file, so it is what they judge from. It is plain
JSON and you can ask to see yours. Everything else about scoring is a local script and
stays local. If even the trimmed file matters to you, tell a facilitator and they'll score
those three criteria by hand instead — that option is yours, not a favour.

### When your event scores with an AI judge (deck + repository + history)

Some events score with the camp evaluator instead: an AI model (Claude, by Anthropic)
reads your submission against the event's published rubric, and facilitators review the
top five by hand. If your event says it does this, **your proposal deck, your SDLC
diagram image, your repository and your history files are read by an AI model**:

- **Read by the model:** your proposal PDF (every slide, including its images and
  diagrams) and your diagram image; any file in your pushed repository it chooses to open — code, tests, README,
  `AGENTS.md`, docs — **so anything you committed may be read**; and a facts file the
  facilitators' script builds from your repository and history files: counts, timings, the
  prompt and correction excerpts already in your history files (keys redacted), your
  commit messages and their dates, file names, and the file and line of anything
  credential-shaped — never the value.
- **Not given to the model by that script:** the names on your commits, your branch
  names, the names in your history files (members are numbered instead), and the
  scanner's notes about text addressed to an evaluator, which go to facilitators only and
  affect no score.
- **Nothing is run.** Neither the model nor the facilitators execute your application or
  your tests; your code is judged by reading it.
- **Where it runs:** on a facilitator's machine, through their Claude Code account; the
  scorecards and results stay with the facilitators.

Do not commit anything you would not want read — real personal data, credentials, or
files unrelated to the challenge. If this is a problem for you, tell a facilitator before
the deadline.

## A warning, in good faith

The scorer is adversarially tested. We scan the prose an agent reads as instructions —
`AGENTS.md`, `CLAUDE.md`, your README and docs, editor rule files, and the prompt excerpts
in your evidence file — for attempts to instruct it: hidden text, invisible characters,
notes addressed to whatever is reading your files. Your source code, stylesheets,
templates and SQL are not scanned.

**Finding one costs you nothing.** Repo text is treated as data everywhere in this kit and
never as instructions, so an attempt has nothing to act on. The scan writes a note for a
facilitator, who decides whether it means anything at all. No score moves on its own.

We're telling you this now because it's a dare, not a trap. Prompt injection is a real
vulnerability class, and you're about to see it from both sides. Find a way through and
*tell us* instead of using it, and there's a badge in it for you.

## Starting tips

1. **Write `AGENTS.md` first**, before the first line of application code. It's worth
   real points *and* it's the fastest way to make your agent actually useful — a harness
   written after the fact guided nothing.
2. **Write down the problem, not just the rules of the repo.** What the product is, who
   uses it, what must never happen, what you've already decided. It's worth six points on
   its own, and it's the context an agent cannot get by reading your code.
3. **Set up a test command in the first hour**, even a trivial one. You cannot verify
   anything without it, and Verification is the second-heaviest dimension.
4. **Small asks, not one giant prompt.** Direct the agent in steps you can check, not a
   spec dump you hope it interprets correctly.
5. **Read what comes back.** The single biggest score difference between teams is whether
   anyone actually looked at what the agent did before moving on.
6. **Close one loop properly, early.** Goal, change, test run, your review — all in one
   session. That's a criterion on its own, and it's the shape of everything else.
