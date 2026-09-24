# The Vibe Check — scoring rubric

**100 points across six dimensions.** You get this on day one. Nothing is hidden, nothing
is revealed at the end as a surprise. Optimise for it freely — it is weighted so that the
only way to score well is to actually work well.

Run it on yourself any time:

```bash
node bin/vibecheck.mjs
```

The report it writes lists **every one of the 23 criteria** — the ones you passed as well
as the ones you didn't — and each reads the same three ways: what we looked for, what we
found, and what to do about it. This page is the summary; the report is the detail, and it
is generated from the same file the scorer uses, so the two cannot drift apart.

| # | Dimension | Points | Measured by |
| - | --------- | -----: | ----------- |
| 1 | Working Method | 25 | your AI chat transcripts |
| 2 | Verification Loop | 20 | transcripts + your test suite |
| 3 | Context & Understanding | 20 | your repo + git timestamps |
| 4 | Safety, Privacy & Boundaries | 10 | your repo, plus one facilitator check |
| 5 | Reproducibility & Handover | 10 | your repo |
| 6 | It Actually Works | 15 | a facilitator, watching your demo |

## Handing in — everyone on the team

Your AI transcripts live in your own home directory, so nobody can score how you worked
unless you hand them in. **Every member runs one downloaded file in the project folder and
pushes what it writes:**

```bash
node collect-history.mjs
```

Your facilitators share the file. It writes `.vibecheck/history-<your name>.json`; the
participant one-pager says exactly what the file contains. Your repository is your team — every history file
in it is combined into one score. Skip it and your share of the team's work is invisible to
the score.

**Transcripts can be read from Claude Code (CLI, VS Code or JetBrains extension, or the Code tab in Claude Desktop), Codex (CLI, desktop app or VS Code extension), GitHub Copilot in VS Code, and Cursor.** Browser chats
(ChatGPT, claude.ai, Codex on the web) cannot. Using something else costs you nothing directly — those criteria are reported as
unassessed rather than failed, and ranking uses your share of assessable points — but you
also get no feedback on them, so run `/journal` at milestones instead.

---

## 1. Working Method — 25 points

Did you direct the AI, or did you hope?

*7 of these 25 points — whether your prompts show real goal decomposition — get a
facilitator's read via `/facilitator-judge`, not just a script. Until judged, a
deterministic proxy stands in and your score stays provisional.*

**Earns points:** small explicit goals instead of "build the whole app"; a plan agreed
before code was written; you making the design decisions and delegating the execution;
catching the agent when it went wrong and correcting course; prompts that carry the
context needed to answer them; **at least one piece of work traceable end to end** — a
goal set, the agent doing the work, the result verified, and you stepping back in.

**Scores zero:** one enormous prompt and whatever came back; accepting every suggestion
without reading it; no evidence you ever redirected the agent.

## 2. Verification Loop — 20 points

The line between engineering and hoping.

**Earns points:** tests that exist and actually execute; the agent running them rather
than claiming success; failures followed by a fix and a re-run; success defined before
implementation rather than declared after it.

**Scores zero:** no runnable tests; "done" claimed with nothing behind it; a red suite at
the end.

## 3. Context & Understanding — 20 points

What did you give the agent to work with — about how to work here, and about the problem
itself?

*11 of these 20 points — whether your harness is substantive, and whether your context
documents record the real problem — get a facilitator's read via `/facilitator-judge`, the
same way.*

**Earns points:** an `AGENTS.md` or equivalent holding *your* project's real rules,
commands and constraints; **a context document recording what the product is for and the
rules of its domain** — what must never happen, which decisions are already settled;
path-scoped instructions where they earn their place; the harness existing **before** the
bulk of the code, which we check by timestamp.

**Scores zero:** no instruction file; nothing written down about the problem itself; an
unmodified template; generic advice a good model already follows; a harness committed in
the last hour to look good.

## 4. Safety, Privacy & Boundaries — 10 points

**Earns points:** no secrets in tracked files; `.env` handled properly; sensible tool
permissions; destructive commands not blanket-approved; seed and test data that is
invented rather than lifted from somewhere real.

**Scores zero:** a committed API key.

*The sample-data check is made by a facilitator looking, never by a scan. An invented
`ana@example.com` and a real colleague's address are the same string shape, and no regex
should be allowed to accuse you of the difference.*

## 5. Reproducibility & Handover — 10 points

**Earns points:** documented setup that works from a fresh clone; a stated run command; a
new teammate or a new agent could pick this up cold.

**Scores zero:** it only runs on the laptop that built it.

## 6. It Actually Works — 15 points

A facilitator watches your demo and decides — 10 points on the whole thing working, and 5
scored against **the acceptance checklist for this event**, which you get on day one along
with this page. Process without a product is not the goal.

---

## What we do not reward

**Token volume. Lines of code. Number of commits. Hours logged. Team size.** None of these
are inputs to your score. We are measuring engineering leverage, not consumption. A team
that ships a working, well-verified feature in forty focused prompts beats a team that
burned four hundred.

That last one is worth spelling out, because several criteria count things — corrections,
test runs, closed failures. **They scale with how much work your evidence shows.** Two
corrections is real steering across forty prompts and barely a gesture across four
hundred, so the bar rises with the volume. It never falls below what a single person's day
is held to, so being a small team costs you nothing.

## The injection dare

The scorer is adversarially tested, and the prose an agent reads as instructions —
`AGENTS.md`, `CLAUDE.md`, your README and docs, editor rule files, and the prompt excerpts
in your evidence file — is scanned for attempts to instruct it: hidden text, invisible
characters, notes addressed to whatever is reading your files, anything referencing the
scorer by name while trying to direct it.

**Finding one does not cost you points.** It never has to: repo text is treated as data
everywhere in this kit, never as instructions, so an attempt has nothing to act on. What
the scan produces is a note for a facilitator, who reads it and decides whether it means
anything. Your source code, stylesheets, templates and SQL are not scanned at all.

This is a dare, not a trap. Prompt injection is a real vulnerability class and you are
about to see it from both sides. If you find a way through and *tell us* instead of using
it, there is a badge in it for you.

We used to zero a team's score automatically on any hit. We stopped, because the scan
misfired: an ordinary emoji and a white background in an HTML email were both read as
concealed text. Being wrongly told you cheated is a far worse outcome than a clumsy
attempt going unpunished, so no automatic penalty exists any more.
