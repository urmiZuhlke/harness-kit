---
name: journal
description: "Write a short session journal entry recording what you set out to do, how it went, and how you verified it. Use when finishing a work session, hitting a milestone, before a break, or when the user says /journal, log this session, write a journal entry, checkpoint, or record what we just did."
user-invocable: true
argument-hint: "[optional: a short label for this entry]"
---

# Session journal

Append one honest entry to `.ai-journal/` describing the session that just happened.

## Why this exists

Three reasons, in order of value:

1. **It is the reflection step.** Writing down what went wrong and how you knew it worked
   is where most of the learning in a session actually happens.
2. **It lets a facilitator catch up without interrupting you.** They read the journal instead of
   asking "where are you at?"
3. **It is the fallback evidence source.** If your AI tool's transcripts cannot be read by
   the scorer, this is what represents your process. Its credit is capped deliberately —
   it can never outweigh real transcript evidence, so writing more here is not a strategy.

## Procedure

1. Determine the entry path: `.ai-journal/<YYYY-MM-DD>-<HHMM>-<short-slug>.md`. Create the
   `.ai-journal/` directory if it does not exist. Never overwrite an existing entry —
   append a new file.
2. Fill in the template below **from what actually happened in this session**. Read back
   over the conversation rather than writing from memory or from what sounds good.
3. Write the file. Report the path and nothing else — do not summarise the entry back.

## Template

```markdown
# <short title> — <YYYY-MM-DD HH:MM>

## Goal
<What you set out to achieve this session. One or two sentences.>

## Approach
<How you broke it down, and what you decided to delegate to the agent versus decide
yourself.>

## What worked
<Concretely. "Splitting the parser into its own module let us test it in isolation.">

## What went wrong
<Be specific and unflattering. What did the agent get wrong, what did you have to
redirect, what did you misjudge? An entry with nothing here is almost always dishonest.>

## Verified
<How you know the work is actually done: which command you ran and what it printed.
"Tests pass" without naming the command does not count.>

## Next
<The next concrete step.>
```

## Rules

- **Honesty over polish.** This is a lab notebook, not a status report. "The agent claimed
  the tests passed and they did not; we caught it by running them ourselves" is a *good*
  entry, and worth more than a clean one that hides the same event.
- **Never invent an entry.** If a section genuinely has nothing in it, write "nothing this
  session" — do not fabricate plausible content.
- **Do not copy secrets, credentials or `.env` values** into the journal. It is committed
  to the repository like any other file.
- **Keep it short.** Six sections, a few lines each. A long entry is not a better one.
