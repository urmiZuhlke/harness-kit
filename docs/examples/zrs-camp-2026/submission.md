# Submission contract — what each team pushes, and where

The evaluator expects files at fixed paths. A file in the wrong place is a file the
evaluator does not see, so this page is short on purpose and every team gets it verbatim.

## One repository per team

Two things to add, nothing optional:

```
<your-repo>/
├── submission/
│   └── proposal.pdf                   the ≤10-slide deck, as PDF (not PPTX), including
│                                      the SDLC diagram the brief asks for
├── .vibecheck/
│   └── history-<name>.json            one per team member, written by collect-history.mjs
└── … everything else you already have: code, tests, README, AGENTS.md, docs …
```

- **PDF only.** PowerPoint: *File → Export → PDF*. The evaluator reads PDFs, including
  their images and diagrams; a `.pptx` is not read at all, so a team that commits only a
  PPTX is scored as having no proposal.
- **Every member** runs `collect-history.mjs` in the project folder and pushes the file it
  writes. A member who does not is invisible to the Agentic SDLC score.
- **Push to the default branch before 14:00.** The evaluator clones the default branch at
  14:00; later pushes are not seen.
- **Give the facilitators read access** (see "Hosting" below) and submit the repository URL.

## Announcement text for teams (send today)

> **How to hand in (by 14:00 tomorrow).** Everything goes into your team's repository:
>
> 1. Export your proposal deck to **PDF** (PowerPoint: File → Export → PDF) and commit it
>    as `submission/proposal.pdf`. A `.pptx` is not read.
> 2. **Every team member**, on the laptop they used: download `collect-history.mjs` from
>    <SHARED LINK>, open a terminal in your project folder and run
>    `node collect-history.mjs` (Node 20+). Commit and push the file it creates in
>    `.vibecheck/`. If you used Copilot in VS Code, make sure you opened the project
>    *folder* in VS Code — chats in a window with no folder open cannot be matched.
> 3. Push to your default branch and submit the repository URL in <FORM / CHANNEL>.
>
> The file from step 2 contains counts and short snippets of your prompts (keys and
> passwords redacted) — never whole conversations or code. Run it with `--help` to see
> exactly what it contains, and open it before committing.
>
> Scoring is done by an AI model (Claude) reading your deck, repository and history files
> against the published evaluation criteria; facilitators then review the top five.
> Nobody runs your application — it is judged by reading the code.

## Hosting (facilitators decide before announcing)

The clone step must work unattended for twenty repositories in two minutes, so decide one:

- **One group/organisation** (e.g. an internal GitLab group or a GitHub org) where every
  team creates its repository — facilitators have access by default. Preferred.
- **Team-owned repositories** with one facilitator account added as a reader — works, but
  one forgotten invitation is one team that cannot be scored.

Either way, collect URLs as `team-name,url` lines into `repos.txt`, and test cloning two of
them the evening before.

## Conflict with the published brief — decide and announce

The brief says *"A separate prompt log is not required."* Requiring the history file
changes that. Either announce it as required (recommended — without it the Agentic SDLC
"application" points rest on self-reported diagrams), or keep it optional and accept that
C4 is scored from repo evidence alone for teams that skip it (capped at 2/5 either way).
