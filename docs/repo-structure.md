# Repo Structure

Reference for anyone changing the kit. To just use it, read the
[README](../README.md) and [the rubric](rubric.md) instead.

```
harness-kit/
├── README.md                          ← what this is, for teams and for facilitators
├── bin/
│   ├── collect-history.mjs            ← participant hand-in: writes .vibecheck/history-<me>.json
│   ├── vibecheck.mjs                  ← self-check; --team writes the older hand-in file
│   ├── leaderboard.mjs                ← what a facilitator runs: --repos <clones>, rank
│   └── merge-evidence.mjs             ← merge by hand; the leaderboard does it for you
├── dist/
│   └── collect-history.mjs            ← GENERATED single file participants download
├── lib/
│   ├── harvest/                       ← repo, git, journal + one adapter per AI tool
│   │   ├── adapters/                  ← claude-code · copilot · codex · cursor
│   │   ├── history.mjs                ← one person's chat history — all the collector reads
│   │   ├── redact.mjs                 ← credential patterns; masks every excerpt
│   │   └── merge.mjs                  ← union sessions, re-derive every total
│   ├── score/                         ← dimensions.mjs is the rubric as code
│   │   └── judging-bundle.mjs         ← the only thing that reaches a model
│   ├── integrity/injection.mjs        ← notes for a facilitator; moves no number
│   └── report/                        ← report.html and the leaderboard page
├── docs/
│   ├── rubric.md                      ← THE scoring standard: 6 dimensions, 100 points
│   ├── participant-one-pager.md       ← what teams get, incl. the privacy notice
│   ├── facilitator-field-guide.md     ← one page for whoever runs the event
│   ├── facilitator-scorecard.template.json
│   ├── acceptance-checklist.template.json  ← write one per event from its own brief
│   ├── examples/                      ← worked instances; never part of the rubric
│   ├── repo-structure.md              ← you are here
│   └── stories/                       ← the build plan, one file per story
├── 02-agentic-preparation/            ← what teams start from
│   ├── cross-tool-setup.md
│   ├── templates/
│   │   ├── AGENTS.md · CLAUDE.md · copilot-instructions.md
│   │   ├── project-context.md         ← the problem, not the repo (scored separately)
│   │   ├── story-template.md · ai-infrastructure.md
│   │   └── instructions/              ← 8 generic path-scoped rule files
│   └── skills/systematic-debugging/
├── 03-agent-setup/                    ← the agent roster + reference workflows
│   ├── agents-overview.md
│   ├── agents/                        ← Planner, Implementer, Reviewer, Explore
│   │   └── claude/                    ← Claude-side skill equivalents
│   └── workflows/ci.yml · security-scan.yml
├── .claude-plugin/marketplace.json    ← makes this repo an installable plugin marketplace
└── plugin/                            ← the optional global-install slice
    ├── scripts/install.mjs            ← copies agents + skills into personal folders
    ├── scripts/scaffold-new-project.mjs
    ├── agents/                        ← bundled mirror of 03-agent-setup/agents/
    └── skills/harness-kit/            ← /harness-kit new · /harness-kit init
```

## Where the rules live

- **The rubric is `lib/score/dimensions.mjs`.** [`rubric.md`](rubric.md) is the published
  summary of the same weights, and `kit-check` fails the build if the two disagree.
- **What "it works" means is not in the rubric.** It comes from each event's acceptance
  checklist, so the kit survives the next event without a fork.
- **Every adapter produces the same session shape**, which is what lets `merge.mjs` union
  them and `summariseSessions` re-derive one set of totals for a whole team.

## The two sections, one line each

1. **`02-agentic-preparation/`** — the harness templates a team fills in. Starting points,
   never answers: the rubric scores substance, so an unmodified template earns almost
   nothing.
2. **`03-agent-setup/`** — a small generic agent roster (Planner → Implementer → Reviewer,
   plus a read-only Explore) and reference CI/security workflows.
