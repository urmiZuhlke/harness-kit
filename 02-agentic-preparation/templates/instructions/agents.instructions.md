---
description: 'Apply when creating or editing any agent definition file (.agent.md). Enforces the interaction convention: agents must always use the ask-questions tool for any clarifying question, including single questions, and especially when running as a handoff target or subagent.'
applyTo: '**/*.agent.md'
---

# Agent Authoring Convention

Applies to every `*.agent.md` file in this repository.

## Core rule

**Never ask a question by writing it in the response text.** Always call the
ask-questions tool (`vscode/askQuestions`), even for a single question. This applies
in direct mode, handoff mode, and subagent mode alike.

## Mandatory for every agent file

1. The ask-questions tool must appear in the agent's `tools:` frontmatter list.
2. An explicit **Interaction Mode** section must appear in the agent body, near the
   top, before the first procedural step.

## Standard Interaction Mode block

Every interactive agent must include this block verbatim (adjust the tool name to
match your environment):

```markdown
## Interaction Mode

Regardless of how this agent is invoked — directly by the user, as a handoff target
from another agent, or as a subagent — **all clarifying questions must be asked using
the ask-questions tool**, never as plain text in the response. This applies even if
there is only one question.

- Batch all questions into a **single** ask-questions call — do not ask one question,
  wait, then ask another.
- **Prefer asking over assuming.** When in doubt, ask — a question is always cheaper
  than fixing a wrong assumption.
- Only skip a question if the answer is explicitly stated in the prompt, the handoff
  context, or project documentation.
- **Always include your recommendation.** For every question, state which option you
  suggest and why — grounded in evidence from the codebase, docs, or project context.
```

## Recommendation format (every question)

```
[Question text]

**I suggest:** [your recommendation]
**Because:** [evidence — cite specific files, existing patterns, project context, or
architectural reasons]
```

## Spirit over letter

These rules exist to prevent unexamined assumptions. Do not look for technicalities
that let you skip a question you should ask. If a reasonable engineer would clarify
before proceeding, clarify.

## Honesty over agreeableness

Agents must be transparent and honest — this is invariant #13 in `AGENTS.md`. When an
agent surfaces an opinion, a review, or a recommendation, it states what it actually
thinks, including disagreement. Do not draft agents that flatter the user, manufacture
agreement, or soften real problems to seem helpful. If a request rests on a false
premise or an approach is flawed, the agent says so plainly, with reasons. Uncertainty
is flagged, not hidden behind confident guessing. Honest, pragmatic pushback is the
behaviour we want — pleasant validation that wastes the user's time is not.

## Compliance checklist for a new agent

- [ ] ask-questions tool in `tools:` frontmatter
- [ ] Interaction Mode section in body
- [ ] No step says "ask the user X" as plain text without calling the tool
- [ ] Subagent / handoff sections also specify to use the tool
