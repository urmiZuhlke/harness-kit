# Facilitator field guide

One page. Print it, or keep it open on your phone. It exists so every facilitator gives
the same guidance to every team — not so you read it once and forget it.

## The two-minute card

Six dimensions, 100 points. When you check in on a team, you are looking for evidence of
each — not asking them to recite it.

| Dimension | Pts | Good looks like | Bad looks like |
| --------- | --: | ---------------- | --------------- |
| **Working Method** | 25 | Small, explicit asks. The agent gets redirected when it drifts. A plan agreed before code. One piece of work traced goal → change → test → review. | "Vibing": the whole spec pasted once, then hoping. Every suggestion accepted unread. |
| **Verification Loop** | 20 | Tests exist and run *during* the work. A failure gets fixed and re-run. | "It works" with nothing behind it. Tests nobody has run since this morning. |
| **Context & Understanding** | 20 | `AGENTS.md` written early with *this* project's real rules — and a context doc saying what the product is for and what must never happen. | An untouched template. Nothing written down about the problem itself. A harness committed ten minutes ago. |
| **Safety, Privacy & Boundaries** | 10 | No secrets committed. `.env` handled. Seed data invented. | A hardcoded key they'll "remove before commit" and don't. Test data lifted from a real system. |
| **Reproducibility** | 10 | A fresh clone can set up and run. Dependencies pinned. | No lockfile, no setup script — and nobody has tried a fresh clone to find out. |
| **It Actually Works** | 15 | Yours to judge: 10 on the demo, 5 against this event's acceptance checklist. | A demo that only survives if you don't touch anything. |

The right-hand column is the failure mode to watch for even when a team looks busy.

## Before the event starts — three things

1. **Write the acceptance checklist** from the brief the teams are given, using
   [`acceptance-checklist.template.json`](acceptance-checklist.template.json). There is a
   worked example in [`examples/`](examples/acceptance-checklist.desk-booking.json). Hand
   it to teams on day one with the rubric — it is 5 points and it should not be a surprise.
2. **Agree one tool and model for the judging pass**, and one person or pair to run it.
   Different models read the same evidence differently. That variance is expected, but
   same-model comparisons are much stronger, and this is the only control you actually have.
3. **Pin the scorer version.** Everyone runs the same build for the whole event. Re-scoring
   half the teams on a newer scorer makes the ranking indefensible — `SCORER_VERSION`
   prints on the leaderboard so you can prove it did not move.

## Intervention ladder

The most valuable moment of the event is a team discovering, on their own, that the agent
told them tests passed when they didn't. Don't take that moment away from them.

1. **Observe first.** Walk past. Glance at their screen. Say nothing unless asked.
2. **Ask, don't tell.** "How do you know that works?" beats "you haven't run the tests."
   A question they answer themselves teaches more than an instruction they follow.
3. **Answer directly only when:**
   - They are stuck on tooling, not judgement (a command that won't run, an install error).
   - They are about to lose significant time to something a thirty-second answer resolves.
   - They ask a direct question and visibly want a direct answer, not a hint.
4. **Never answer directly when** the team is mid-disagreement about their own approach —
   let them resolve it. That disagreement is the workshop.

## Cadence

Sized by ratio, because events differ: **two to four teams per facilitator**. Twenty teams
therefore needs five to ten of you. More teams than that per person and you are not
facilitating, you are walking.

- **Every ~90 minutes**, a short pass: one lap of your teams, two minutes each,
  intervention ladder above.
- **Once per day, ideally before lunch**, every team runs the check and reads the output.
  It is the single best moment of the event, because they can still act on what it says.
  On a two-day event this happens twice, and the day-one run matters most.
- **Some events forbid a mandatory checkpoint** and leave it to teams to ask for feedback
  when they want it. Respect that — but a team that has not run the check by the end of
  day one is not exercising judgement, it is unaware the command exists. Ask whether they
  have run it; that is information, not an intervention.
- **Last 90 minutes before hand-in**: stop new features. Push toward a working demo and a
  green suite. A team polishing `AGENTS.md` with an hour left is optimising the wrong thing.
- **Demo time**: watch it run. Score `demo` (0–10) and tick off the acceptance checklist in
  their `facilitator-scorecard.json`
  ([template](facilitator-scorecard.template.json)). Ask where their seed data came from
  and record the privacy check. Award any badges.

## Teams are more than one person — so is their evidence

**This is the thing most likely to go wrong on the day.** AI transcripts live in each
person's home directory. A check run on one laptop measures one person and reports it as
the team, and nothing about the output looks wrong.

Each member runs `node bin/vibecheck.mjs --harvest-only` in the team's repo. Someone
collects the files into one folder per person and runs `node bin/merge-evidence.mjs --dir
collected --out team/evidence.json`, then `node bin/vibecheck.mjs --evidence
team/evidence.json`. The merge prints one line per member — **read it**: a member with zero
sessions either used a tool the kit cannot read or never harvested, and both are worth
knowing before you rank anyone.

Have every team do this once mid-way, not only at hand-in. Discovering at 13:55 that one
person's tool produced nothing is a problem; discovering it on day one is a five-minute fix.

## When the authoritative snapshot is taken

Harvest and merge **at the hand-in deadline**. That bundle ranks everyone and decides which
teams go through.

Teams that continue improving after hand-in — where the event allows it — get **re-harvested
just before they present**, so the demo you score and the code you scored are the same
thing. Say up front which of the two numbers is the ranking one, and stick to it.

## Judging the criteria a script can't

Run `/facilitator-judge` on a team's `.vibecheck` bundle once they have transcripts and a
harness file — no need to wait for demo time. It reads only their `evidence.json`, never
their repo, and writes `judgement.json` beside it
([example](judgement.example.json)). It covers three criteria: is the harness real, did the
prompts show real decomposition, and do the context documents record the actual problem.
Until judged, those three score from a heuristic — real numbers, usable all day — but the
score stays **provisional**.

Sending a team's `evidence.json` to a model is the one part of scoring that leaves a
machine, and the participants have been told so in writing. Use a tool your organisation
licenses, and if a team objects, judge those three by hand — the option is promised to them
on their one-pager.

## Which tools the kit can read

Claude Code, GitHub Copilot in VS Code, Codex CLI, and Cursor. Anything else reports as
not-harvested, which **costs no points**: those criteria leave the denominator and ranking
uses share of assessable points. What it does cost is feedback, so point those teams at
`/journal` early — it is their fallback evidence and it is capped below what a transcript
earns, deliberately, because they write it about themselves.

Cursor needs Node 22.5 or newer to read. On an older Node it says so rather than silently
finding nothing.

## If the scan flags something

`vibecheck` reads the prose an agent would read as instructions — `AGENTS.md`, `CLAUDE.md`,
the README, docs — looking for text that tries to instruct the scorer. When it finds
something, it prints it under **"Worth a second look"** in the terminal, and that is all it
does.

**It costs no points, and it never reaches the team's report or the leaderboard page.** It
is not published anywhere and no score moves — but it is not secret from the team either:
they see the same line if they run `vibecheck` themselves, which the one-pager tells them
to do. That is deliberate. What it means is your call, not the tool's.

- **Almost every hit is innocent.** An earlier version of this kit zeroed a team's score
  automatically and put it on the big screen. It fired 139 times on one real repo — on the
  emoji in a database migration, on the white background of an HTML email template, and on
  a third-party skill the team had installed but not written. Every single one was wrong.
- **Read the quoted line before saying anything to anyone.** `node bin/vibecheck.mjs
  --explain-integrity` shows exactly which files were scanned, so you can check the scan
  looked where you expected.
- **If it is genuine**, it is a conversation, not a sanction: they tried a real technique,
  and the interesting part is showing them why it did not work. Repo text is treated as
  data everywhere in this kit, so an attempt has nothing to act on. The Responsible
  Disclosure badge exists for a team that finds a way through and tells you.
- **Never accuse a team on a regex alone.** A false accusation costs them their day; a
  missed attempt costs the event almost nothing.

The same rule is why the sample-data privacy check is **yours, not the scanner's**. An
invented `ana@example.com` and a real colleague's address are the same string shape. Ask
the team where their data came from, look at a few records, and write down what you found.

**One thing to expect:** a team that squashes its history to a handful of commits will see
"Context & Understanding" score out of 17 rather than 20. There is no commit ordering left
to read, so "was the harness written first?" goes unscored rather than failed. That is
deliberate — guessing would mean telling a team something false — and because ranking uses
share of assessable points, it costs them nothing.

## When a team finishes early

Point them at the "What to do next" list in their own `report.html` — it's usually not "add
more features," it's "close the loop you left open" (a test that was never re-run, a
harness note that's gone stale). If everything's genuinely closed, harder verification
(an edge case they haven't handled) is a better use of remaining time than more surface
area.

## A note on trust

Scoring executes the team's own test command, discovered from their `package.json`,
`Makefile`, `pom.xml` or language manifest. Run `vibecheck` **on the team's machine, with
the team present** — never point it at a repo you don't know from your own laptop.
`node bin/vibecheck.mjs --no-run-tests` skips execution if you're unsure; the criterion
then reports as unscored rather than failed, so nobody loses points for your caution.
