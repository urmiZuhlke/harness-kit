# The Vibe Check — scoring rubric

**100 points across six dimensions.** You get this on day one. Nothing is hidden, nothing
is revealed at the end as a surprise. Optimise for it freely — it is weighted so that the
only way to score well is to actually work well.

Run it on yourself any time:

```bash
node bin/vibecheck.mjs
```

| # | Dimension | Points | Measured by |
| - | --------- | -----: | ----------- |
| 1 | Working Method | 25 | your AI chat transcripts |
| 2 | Verification Loop | 25 | transcripts + your test suite |
| 3 | Context & Harness | 20 | your repo + git timestamps |
| 4 | Safety & Boundaries | 10 | your repo |
| 5 | Reproducibility & Handover | 10 | your repo |
| 6 | It Actually Works | 10 | a coach, watching your demo |

---

## 1. Working Method — 25 points

Did you direct the AI, or did you hope?

*8 of these 25 points — whether your prompts show real goal decomposition — get a
coach's read via `/coach-judge`, not just a script. Until judged, a deterministic proxy
stands in and your score stays provisional.*

**Earns points:** small explicit goals instead of "build the whole app"; a plan agreed
before code was written; you making the design decisions and delegating the execution;
catching the agent when it went wrong and correcting course; prompts that carry the
context needed to answer them.

**Scores zero:** one enormous prompt and whatever came back; accepting every suggestion
without reading it; no evidence you ever redirected the agent.

## 2. Verification Loop — 25 points

The heaviest dimension, deliberately. This is the line between engineering and hoping.

**Earns points:** tests that exist and actually execute; the agent running them rather
than claiming success; failures followed by a fix and a re-run; success defined before
implementation rather than declared after it.

**Scores zero:** no runnable tests; "done" claimed with nothing behind it; a red suite at
the end of the day.

## 3. Context & Harness — 20 points

What did you give the agent to work with?

*6 of these 20 points — whether your harness is substantive or boilerplate — also get a
coach's read via `/coach-judge`, the same way.*

**Earns points:** an `AGENTS.md` or equivalent holding *your* project's real rules,
commands and constraints; path-scoped instructions where they earn their place; the
harness existing **before** the bulk of the code, which we check by timestamp.

**Scores zero:** no instruction file; an unmodified template; generic advice a good model
already follows; a harness committed in the last hour to look good.

## 4. Safety & Boundaries — 10 points

**Earns points:** no secrets in tracked files; `.env` handled properly; sensible tool
permissions; destructive commands not blanket-approved.

**Scores zero:** a committed API key.

## 5. Reproducibility & Handover — 10 points

**Earns points:** documented setup that works from a fresh clone; a stated run command; a
new teammate or a new agent could pick this up cold.

**Scores zero:** it only runs on the laptop that built it.

## 6. It Actually Works — 10 points

A coach watches your demo and decides. Process without a product is not the goal.

---

## What we do not reward

**Token volume. Lines of code. Number of commits. Hours logged.** None of these are
inputs to your score. We are measuring engineering leverage, not consumption. A team that
ships a working, well-verified feature in forty focused prompts beats a team that burned
four hundred.

## A warning, offered in good faith

The scorer is adversarially tested, and the repo is scanned for attempts to instruct it —
hidden text, invisible characters, notes addressed to whatever is reading your files,
anything referencing the scorer by name.

Try it and you will score **zero**, and we will put it on the big screen with your name on
it and the exact line quoted.

We mention this in advance because it is a dare, not a trap. Prompt injection is a real
vulnerability class and you are about to see it from both sides. If you find a way through
and *tell us* instead of using it, there is a badge in it for you.
