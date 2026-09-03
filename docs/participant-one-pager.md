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

**At hand-in**, give your `.vibecheck/` folder to a facilitator. They recompute your score
independently — editing your own `score.json` changes nothing.

## If you're a team of more than one — read this bit

Your AI transcripts live in *your own* home directory, not in the repo. A check run on one
laptop therefore scores one person's day and calls it the team — and nothing in the output
looks wrong when that happens.

So **every member runs the same one command, with the same team name**:

```bash
node bin/vibecheck.mjs --team "Your Team Name"
```

That writes **one file** to hand in — the path is printed at the end, and the team name
inside it is what links your laptops together. Spell the team name the same way each time;
everything else is handled for you. Commit `.vibecheck/` so the file travels with your
repository, and hand in the repository link.

Do this once mid-way too, not only at the deadline: it is how you find out early that
someone's tool can't be read, which is a five-minute problem on day one and an unfixable
one at 14:00.

**Transcripts can be read from:** Claude Code, GitHub Copilot in VS Code, Codex CLI, and
Cursor. Using something else costs you nothing directly — those criteria come back
"unassessed" rather than failed, and ranking uses your share of assessable points — but
you get no feedback on them either, so run `/journal` at milestones. It's your fallback,
and it's a good habit regardless.

*(Reading Cursor's history needs Node 22.5 or newer. On an older Node it says so rather
than silently finding nothing.)*

## Privacy — what's actually read, and where it goes

`vibecheck` reads your AI chat transcripts **locally** to score how you worked:

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
- **Your team name and who ran the check**, from `--team` and your git `user.name`. On a
  merged team bundle this becomes a per-member breakdown: who contributed, from which repo
  path on their own machine, when, and how many sessions and prompts each. That is the
  audit trail for a merged score, and it is visible to anyone who opens the file.
- **About that test output:** a failing suite often prints file paths and the lines of code
  around the failure, so we can't promise no source code ever appears there. Read it
  yourself in `evidence.json` if that matters to you.
- **Never copied:** full conversations, your source files wholesale, anything from outside
  the repo you're scoring.

`evidence.json` is yours — open it and read exactly what was collected about you.

**One thing does leave your machine.** Three of the 100 points' worth of criteria — is your
harness substantive, did your prompts show real decomposition, do your context documents
record the real problem — cannot be settled by counting, so a facilitator judges them with
an AI model. That is the only step where anything about you reaches a model, and it sends
a **separate, trimmed file**, not your evidence:

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
