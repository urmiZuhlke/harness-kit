---
description: 'Apply when creating, updating, rewriting, or reviewing any GitHub issue (story). Ensures all agents use the canonical story template.'
applyTo: '**'
---

# Story Format

## Rule

Every GitHub issue created or updated by any agent **must** follow the story template
defined in [`.github/story-template.md`](../story-template.md).

Before writing or rewriting a story body, read that file to get the current template
structure, section guide, and quality rules.

## Key sections a reviewer needs

| Section               | Reviewer question it answers      |
| --------------------- | --------------------------------- |
| Intent                | Why are we doing this?            |
| Current Behaviour     | What exists today?                |
| New Behaviour         | What will change?                 |
| Decisions & Rationale | Why is the story shaped this way? |
| Requirements          | What exactly needs to be built?   |
| Acceptance Criteria   | How do we know it is done?        |
| Technical Proposal    | How should this be implemented?   |
| Edge Cases & OOS      | What is in and what is out?       |
| Dependencies          | What must exist before we start?  |

## Do not

- Inline the template in agent files — always read it from `.github/story-template.md`.
- Add or remove sections from the template.
- Skip "Current Behaviour" for new features — write "This capability does not exist yet."
- Use "Summary" as a section name — use "Intent".
