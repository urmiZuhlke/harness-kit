# Facilitator field guide

One page. Print it, or keep it open on your phone. It exists so five facilitators give the
same guidance to ten-plus teams — not so you read it once and forget it.

## The two-minute card

Six dimensions, 100 points. When you check in on a team, you are looking for evidence of
each — not asking them to recite it.

| Dimension | Pts | Good looks like | Bad looks like |
| --------- | --: | ---------------- | --------------- |
| **Working Method** | 25 | Small, explicit asks. The agent gets redirected when it drifts. A plan agreed before code. | "Vibing": the whole spec pasted once, then hoping. Every suggestion accepted unread. |
| **Verification Loop** | 25 | Tests exist and run *during* the work. A failure gets fixed and re-run. | "It works" with nothing behind it. Tests nobody has run since morning. |
| **Context & Harness** | 20 | `AGENTS.md` written early, holding *this* project's real rules. | An untouched template — or a beautiful one nobody reopened. A harness committed in the last ten minutes. |
| **Safety & Boundaries** | 10 | No secrets committed. `.env` handled properly. | A hardcoded key they'll "remove before commit" and don't. |
| **Reproducibility** | 10 | A fresh clone can set up and run. Dependencies pinned. | No lockfile, no setup script — and nobody has tried a fresh clone to find out. |
| **It Actually Works** | 10 | Yours to judge, watching the demo. | A demo that only survives if you don't touch anything. |

The right-hand column is the failure mode to watch for even when a team looks busy.

## Intervention ladder

The most valuable moment of the day is a team discovering, on their own, that the agent
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

## Checkpoint cadence

Sized for **two teams per facilitator** across an 8–16 hour day. Five facilitators, ten teams.

- **Every ~90 minutes**, a short pass: one lap of your two teams, two minutes each,
  intervention ladder above.
- **Mid-point**: every team runs `node bin/vibecheck.mjs` in practice mode. Read their
  output over their shoulder — it's the single best facilitatoring moment of the day, because
  they can still act on what it tells them.
- **Last 90 minutes**: stop new features. Push toward a working demo and a green suite.
  A team polishing `AGENTS.md` with an hour left is optimising the wrong thing.
- **Demo time**: watch it run. Score `it-actually-works` (0–10) into their
  `facilitator-scorecard.json` ([template](facilitator-scorecard.template.json)). Award any badges.

More than ten teams? Pair facilitators on adjacent tables rather than each stretching thinner —
a facilitator actually present for four teams beats one nominally covering eight.

## Judging the two criteria a script can't

Run `/facilitator-judge` on a team's `.vibecheck` bundle once they have transcripts and a
harness file — no need to wait for demo time. It reads only their `evidence.json`, never
their repo, and writes `judgement.json` beside it
([example](judgement.example.json)). Until judged, those two criteria score from a
heuristic — real numbers, usable all day — but the score stays **provisional**.

**Use one tool/model for judging across every team at the same camp.** Different models
read the same evidence differently; that variance is expected, but same-model comparisons
are much stronger. Agree this before you start — the `model` field in `judgement.json` is
self-reported and not reliable enough to reconstruct afterwards.

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

**One thing to expect:** a team that squashes its history to a handful of commits will see
"Context & Harness" score out of 15 rather than 20. There is no commit ordering left to
read, so "was the harness written first?" goes unscored rather than failed. That is
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
`Makefile` or language manifest. Run `vibecheck` **on the team's machine, with the team
present** — never point it at a repo you don't know from your own laptop.
`node bin/vibecheck.mjs --no-run-tests` skips execution if you're unsure; the criterion
then reports as unscored rather than failed, so nobody loses points for your caution.
