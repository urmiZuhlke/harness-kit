# Story Template

This is the canonical template for all GitHub issues (stories) in this repository.
Every agent that creates or updates a GitHub issue **must** use this structure. Do not
add or remove sections — but omit optional sections (marked below) when they have no content.

---

## Template

```markdown
## Intent

[What problem does this solve and why is it needed now? Focus on the user or business
impact, not the technical approach. One to three sentences.]

## Current Behaviour

[How does the system behave today regarding this functionality? If this is a brand-new
capability that does not exist yet, write: "This capability does not exist yet." If this
is a change or fix, describe the actual current behaviour concisely.]

## New Behaviour

[How will the system behave after this story is implemented? Describe the observable
change from the user's or system's perspective. This section combined with Current
Behaviour forms the reviewable delta.]

## Decisions & Rationale

<!-- OPTIONAL — omit if no significant spec-level decisions were made -->

- **[Decision]**: [Rationale]. _(Alternative considered: [what was rejected and why])_

## Requirements

- [What must be implemented — a specific behavioural change, new capability, or constraint]
- [Focus on WHAT, not HOW. Keep each bullet independently understandable.]
- [No sub-bullets. No "and" connecting two independent requirements in one bullet.]

## Acceptance Criteria

- [ ] [Specific, independently testable condition — prefer Given / When / Then for flows]
- [ ] [Cover the happy path, error/failure paths, and permission boundaries]
- [ ] [Negative cases: what must NOT happen]

## Technical Proposal

<!-- OPTIONAL — advisory, not prescriptive. The implementer may deviate. -->

- **Affected files**: [Files to modify/create and the design intent]
- **Database changes**: [Changes to any database artefacts — or "None"]
- **API changes**: [Endpoints with method, path, key request/response shape — or "None"]
- **Key implementation notes**: [Algorithms, libraries, configuration, non-obvious patterns]

## Edge Cases & Out of Scope

**Edge cases to handle:**

- [Boundary or unusual scenario the implementation must handle]

**Out of scope:**

- [Explicitly excluded items to prevent scope creep]

## Dependencies

<!-- OPTIONAL — omit if there are no dependencies -->

- #[issue-number] — [what it provides]
- [External dependency]
```

---

## Section Guide

| Section               | Required | Purpose for the reviewer                              |
| --------------------- | -------- | ----------------------------------------------------- |
| Intent                | Yes      | "Why are we doing this?"                              |
| Current Behaviour     | Yes      | Establishes the baseline.                             |
| New Behaviour         | Yes      | The target state — together with Current, the delta.  |
| Decisions & Rationale | Optional | Records spec-level choices + rejected alternatives.   |
| Requirements          | Yes      | The actionable list of what must be built.            |
| Acceptance Criteria   | Yes      | Testable conditions that define "done".               |
| Technical Proposal    | Optional | Advisory implementation roadmap.                      |
| Edge Cases & OOS      | Yes      | Prevents scope creep, documents non-obvious handling. |
| Dependencies          | Optional | Prerequisite stories or external systems.             |

## Quality Rules

1. **Intent**: 1–3 sentences describing impact, not technical detail.
2. **Current Behaviour**: never "N/A" — write "This capability does not exist yet".
3. **New Behaviour**: understandable without reading Requirements.
4. **Decisions**: name the decision, the rationale, and one considered alternative. Omit if none.
5. **Requirements**: each bullet a complete thought; no implementation detail.
6. **Acceptance Criteria**: each starts with a verb; cover at least one error/failure case.
7. **Technical Proposal**: concrete file paths / endpoint signatures / table names. Omit if trivial.
8. **Edge Cases**: concrete, not hypothetical.
9. **Out of Scope**: include at least one plausibly-misread-as-in-scope item.
10. **Dependencies**: link issue numbers where possible.
11. **Length**: trim ruthlessly — a story that needs scrolling is too long.
