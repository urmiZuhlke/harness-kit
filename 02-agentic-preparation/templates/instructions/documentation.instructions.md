---
description: 'Apply when editing any Markdown file. Ensures formatting is run after every .md change.'
applyTo: '**/*.md'
---

# Documentation Formatting

## Update docs in the same change

When a change alters behaviour that a doc describes (architecture, schema, API shape, a
documented decision), update that doc **in the same PR/commit** — never as a follow-up
task. This is a non-negotiable invariant (see `AGENTS.md`); it applies to any `.md` edit,
not just the files formatted below.

## Formatting after Markdown edits

After editing **any** `.md` file in this repository, run the repository's formatter
before considering the task complete:

```
{{FORMAT_COMMAND}}
```

(Adjust the command to your project's formatter, e.g. `prettier --write "**/*.md"`.)

Consistent formatting keeps documentation diffs small and reviewable.
