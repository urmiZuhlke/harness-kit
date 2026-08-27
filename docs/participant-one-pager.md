# Participant one-pager

## What you're building

A working use case, built *with* an AI coding agent, in one continuous stretch of
8–16 hours. Finishing the use case is necessary but not sufficient — how you got there
is worth as much as what you shipped.

## How you're scored

**100 points, six dimensions.** Nothing below is hidden or added later — this is the
whole rubric, and you're free to optimise for it. It's weighted so the only way to score
well is to actually work well.

| # | Dimension | Points | Measured from |
| - | --------- | -----: | -------------- |
| 1 | Working Method | 25 | your AI chat transcripts |
| 2 | Verification Loop | 25 | your transcripts + your test suite |
| 3 | Context & Harness | 20 | your repo + git timestamps |
| 4 | Safety & Boundaries | 10 | your repo |
| 5 | Reproducibility & Handover | 10 | your repo |
| 6 | It Actually Works | 10 | a coach, watching your demo |

Full detail on what earns points in each — [`docs/rubric.md`](rubric.md).

**What doesn't count:** token volume, lines of code, commit count, hours logged. We're
measuring engineering leverage, not consumption.

## How the score is produced

Run it yourself, any time, unlimited:

```bash
node bin/vibecheck.mjs
```

This reads your repo, your git history, and your AI chat transcripts — **on your own
machine, locally** — and writes `.vibecheck/report.html`: your score, what you did well,
what to do next ranked by what it's worth, and then all 19 criteria in full. Each one tells
you the same three things — what we looked for, what we found, and what to do about it —
whether you scored full marks on it or nothing at all.

This is **practice mode**. Dimension 6 ("It Actually Works") stays unscored until a coach
watches your demo. Everything else is real, live, and yours to act on all day.

**At the mid-point**, run it again and read the output with a coach. It's the best
fifteen minutes you'll spend all day — you'll still have time to close whatever it finds.

**At the end**, hand your `.vibecheck/` folder to a coach. They recompute your score
independently — editing your own `score.json` changes nothing.

## Privacy — what's actually read, and where it goes

`vibecheck` reads your AI chat transcripts **locally** to score how you worked:

- **Read:** message counts, prompt lengths, which tools got called, whether tests were
  run and whether they passed, commit timestamps.
- **Extracted into `.vibecheck/evidence.json`:** short excerpts (under 300 characters) of
  a handful of prompts, so a coach can see *how* you asked for things — never a full
  transcript. Plus the first ~4,000 characters of your harness files (`AGENTS.md` and
  friends), with anything that looks like a credential automatically replaced by
  `[redacted]` before it's written.
- **Also recorded:** the file and line of anything that looks like a credential —
  locations only, never the value itself; the names on your commits; the path to your repo
  on this machine and your branch names; the names of the tools your agent called; and up
  to 4,000 characters of whatever your test command last printed, with credential-shaped
  strings replaced by `[redacted]`.
- **About that test output:** a failing suite often prints file paths and the lines of code
  around the failure, so we can't promise no source code ever appears there. Read it
  yourself in `evidence.json` if that matters to you.
- **Never copied:** full conversations, your source files wholesale, anything from outside
  the repo you're scoring.

`evidence.json` is yours — open it and read exactly what was collected about you.

**One thing does leave your machine.** Two of the 100 points' worth of criteria — is your
harness substantive, did your prompts show real decomposition — are judged by a coach
running an AI judging pass. **That step sends your whole `evidence.json`** to an AI model:
everything listed above — prompt excerpts, your instruction and context files with
credentials redacted, credential locations, committer names, your repo path and branch
names, the tool names your agent called, filenames and counts, and your last test run's
output. The whole of that one file, not a selection from it. It is a plain
JSON file sitting in your repo, so open it before you agree: what you read there is exactly
what gets sent.

The rest of the scoring is a local script and stays local. If any of that matters to you,
tell a coach and they'll score those two criteria by hand instead.

If your AI tool isn't one we can read (only Claude Code and Copilot are supported today),
run `/journal` at milestones — it's your fallback and it's a genuinely useful habit
either way.

## A warning, in good faith

The scorer is adversarially tested. We scan the prose an agent reads as instructions —
`AGENTS.md`, `CLAUDE.md`, your README and docs, editor rule files, and the prompt excerpts
in your evidence file — for attempts to instruct it: hidden text, invisible characters,
notes addressed to whatever is reading your files. Your source code, stylesheets,
templates and SQL are not scanned.

**Finding one costs you nothing.** Repo text is treated as data everywhere in this kit and
never as instructions, so an attempt has nothing to act on. The scan writes a note for a
coach, who decides whether it means anything at all. No score moves on its own.

We're telling you this now because it's a dare, not a trap. Prompt injection is a real
vulnerability class, and you're about to see it from both sides. Find a way through and
*tell us* instead of using it, and there's a badge in it for you.

## Starting tips

1. **Write `AGENTS.md` first**, before the first line of application code. It's worth
   real points *and* it's the fastest way to make your agent actually useful — a harness
   written after the fact guided nothing.
2. **Set up a test command in the first hour**, even a trivial one. You cannot verify
   anything without it, and Verification is worth more than any other dimension.
3. **Small asks, not one giant prompt.** Direct the agent in steps you can check, not a
   spec dump you hope it interprets correctly.
4. **Read what comes back.** The single biggest score difference between teams is whether
   anyone actually looked at what the agent did before moving on.
5. **Run practice mode early**, not just at the mid-point. It costs you nothing and tells
   you exactly what's worth doing next.
