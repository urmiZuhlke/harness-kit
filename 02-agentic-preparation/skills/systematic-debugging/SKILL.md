---
name: systematic-debugging
description: 'Use when encountering any bug, test failure, or unexpected behaviour. Enforces root cause investigation before attempting fixes. Prevents guess-and-check thrashing.'
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue: test failures (any runner, integration),
backend runtime/guard/middleware errors, ORM query or migration errors, Module
integration/contract failures, build failures (any bundler or compileript, ESLint), CI
failures, unexpected API responses.

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

Before attempting ANY fix:

1. **Read the full error message** — stack traces, line numbers, error codes. Don't skim.
2. **Reproduce consistently** — can you trigger it reliably? If not, gather more data.
3. **Identify the exact failure point** — which file, line, function.
4. **Understand the data flow** — trace inputs from entry point to failure point.
5. **Check the business context** — for anything touching domain records, status
   transitions, access rules, or a business flow, read `docs/project-context.md` (the
   business-context doc). A "bug" is often correct behaviour under a domain rule you haven't
   read yet; conversely the doc often names the legal states the code should enforce. Debug
   with the domain in mind, not just the stack. If the doc is missing or thin, note it.

Where to look by area:

- Backend errors → bootstrap (`main.ts`), module imports, guard registration
- ORM errors → schema definitions, migration files, the barrel export
- Frontend errors → routing, module/bundle boundaries
- Integration test errors → the shared app-factory mock setup

### Phase 2: Pattern Analysis

1. **Has this error occurred before?** Search git log, tests, and any `docs/learnings.md`.
2. **Is this a known category?** Missing DI provider, guard rejection, schema mismatch,
   MF contract break, etc.
3. **What changed recently?** Check `git diff` and recent commits touching the area.

### Phase 3: Hypothesis and Testing

1. **Form ONE hypothesis** — "The failure occurs because X".
2. **Test ONE variable at a time** — smallest possible change to prove/disprove.
3. **Verify** — evidence supports it? YES → Phase 4. NO → back to Phase 1 with new info.

### Phase 4: Implementation

1. **Write a test that reproduces the bug** (red) — proves you understand root cause.
2. **Implement the minimal fix** (green) — change only what is necessary.
3. **Verify the fix** — run the full relevant suite, paste output.
4. **Check for regressions.**

## The 3-Fix Escalation Rule

```
If your fix doesn't work:
- STOP. Count how many fixes you've tried.
- If < 3: return to Phase 1, re-analyse with new information.
- If ≥ 3: STOP COMPLETELY and escalate to the user via the ask-questions tool.
3 failed fixes = you don't understand the problem yet.
```

## Red Flags — STOP and Return to Phase 1

| Thought                                        | Reality                                                        |
| ---------------------------------------------- | -------------------------------------------------------------- |
| "Quick fix for now, investigate later"         | Later never comes. Find root cause now.                        |
| "Just try changing X and see if it works"      | That's guessing, not debugging. Trace the data flow.           |
| "It's probably X, let me fix that"             | "Probably" = unverified. Verify first.                         |
| "Add multiple changes, run tests"              | Can't isolate what worked. ONE variable at a time.             |
| "I don't fully understand but this might work" | Might ≠ will. Understand fully, then fix.                      |
| "The issue is simple"                          | Simple issues have root causes too.                            |
| "I'm in a hurry"                               | Systematic debugging is FASTER than guess-and-check thrashing. |
| "One more fix attempt" (after 2+ failures)     | 3 failed fixes = escalate.                                     |

## Forbidden Patterns

- Proposing fixes before completing Phase 1
- Multiple changes at once
- Skipping test creation before the fix
- Attempting 4+ fixes without escalating
- "While I'm here" fixes to unrelated code
- Suppressing errors instead of fixing root cause (`try/catch` that swallows,
  `@ts-ignore`, `eslint-disable`)
