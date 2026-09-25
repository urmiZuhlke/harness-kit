# Morning message to teams — how to prepare your repository

Send this verbatim on day 2. It replaces the earlier announcement in
[`submission.md`](submission.md), which did not yet ask for the diagram as its own image.
Fill in the two `<…>` placeholders first.

---

**Hand-in today by 14:00 — everything goes into your team's repository, on the default
branch.** Anything pushed after 14:00, or on another branch, is not seen.

1. **Proposal deck → `submission/proposal.pdf`**
   Export your deck (max. 10 slides, slide 1 = Executive Summary) to **PDF** — PowerPoint:
   *File → Export → PDF*. Keep it **under 20 MB** (*File → Reduce File Size* if needed) and
   commit it as a normal file, not with Git LFS. A `.pptx` is **not read** — a team with only
   a PPTX is scored as having no proposal.

2. **AI SDLC diagram → `submission/sdlc-diagram.png`** (or `.jpg`)
   Export the diagram on its own as an image. It can also stay in the deck, but the image is
   what the evaluator reads first.

3. **AI chat history → `.vibecheck/history-<name>.json`, one per team member**
   **Every member**, on the laptop they worked on: download `collect-history.mjs` from
   <SHARED LINK>, open a terminal **in the project folder** and run
   `node collect-history.mjs` (Node 20+). It also checks steps 1 and 2 and warns you if
   something is missing or in the wrong place. Commit and push the file it writes.
   A member who skips this is invisible to the Agentic SDLC score.

4. **Push to the default branch** and send your repository URL to <FORM / CHANNEL>.
   Make sure the facilitators can read the repository.

**Before you push, check:**

```
submission/proposal.pdf            ← PDF, not PPTX, under 20 MB
submission/sdlc-diagram.png        ← or .jpg
.vibecheck/history-<name>.json     ← one per member
```

**Check it with your AI agent.** Paste the hand-in check prompt (sent with this message;
[`team-check-prompt.md`](team-check-prompt.md)) into your coding agent in the project
folder. It checks all of the above and tells you what is missing — it does not create
the files for you.

**How you are scored.** An AI model (Claude) reads your deck, diagram, repository and
history files against the published evaluation criteria; facilitators then review the top
five. **Nobody runs your application** — the code is judged by reading it. Do not commit
real personal data, passwords or keys: anything in the repository may be read. The
history file contains counts and short snippets of your prompts (keys redacted), never
whole conversations or code — run `node collect-history.mjs --help` to see exactly what.
