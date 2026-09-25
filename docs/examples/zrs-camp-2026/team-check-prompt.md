# Hand-in check — a prompt every team pastes into its AI agent

Send this with the morning message ([`team-instructions.md`](team-instructions.md)). Teams
paste it into their coding agent (Claude Code, Copilot, Codex, Cursor), opened in their
project folder, before 14:00. The agent checks and reports; it never creates or fakes a
hand-in file, and it commits or pushes only after the team says yes.

---

```text
Check our team's camp hand-in and tell us what is missing. Only what is pushed to this
repository's DEFAULT BRANCH by 14:00 today is evaluated.

Rules for you: do not create, generate, edit, move or delete any hand-in file yourself —
no placeholder PDF, no drawn diagram, no edited or invented history file. You may suggest
fixes and exact commands, but run a commit or push only after I say yes. Work from the
git top level of this folder.

1. Branch. Find the default branch (origin/HEAD) and the branch we are on. Everything
   below must be on the default branch.

2. Proposal deck: submission/proposal.pdf (exact path, case-sensitive)
   - exists, is tracked by git (git ls-files) and is not ignored (git check-ignore)
   - is a real PDF: the file starts with "%PDF-". If it starts with
     "version https://git-lfs" it is a Git LFS pointer: it must be a normal file.
   - is under 20 MB
   - has at most 10 pages and page 1 is the Executive Summary (open it if you can
     read PDFs; otherwise ask me to confirm)
   - if the only deck is a .pptx, that fails: a PPTX is not read — export to PDF
   - if a PDF deck exists elsewhere (e.g. docs/) but not at this path, that fails:
     it must be moved to submission/proposal.pdf

3. SDLC diagram: submission/sdlc-diagram.png or submission/sdlc-diagram.jpg
   - exists, is tracked, is not ignored, is not a Git LFS pointer
   - is a real image: PNG files start with bytes 89 50 4E 47, JPEG with FF D8
   - shows the AI SDLC diagram on its own (look at it if you can view images;
     otherwise ask me)

4. AI chat history: .vibecheck/history-<name>.json, one per team member
   - list the files; each is valid JSON with "kind": "history" (report counts only —
     do not print or change their contents)
   - list commit authors (git shortlog -sne HEAD) and ask me who is on the team;
     name every member without a file. Each of them must run
     "node collect-history.mjs" on their OWN laptop, in this project folder, and push
     the file it writes — you cannot make it for them.
   - the files are tracked and not ignored (.vibecheck/ is often in .gitignore; then
     it needs "git add -f")

5. Pushed. Run git fetch. Report anything uncommitted in submission/ or .vibecheck/,
   and any commit on the local default branch that is not on origin
   (git status -sb, git log origin/<default>..HEAD). Give the hash and time of the
   latest commit on origin/<default>.

6. Warnings (not blockers): a tracked .env file or anything that looks like a key,
   password or token in tracked files; a README that does not say what the project
   is and how to run it; real personal data in test or seed data.

Report as a table: Check | Status (OK / FIX / ASK ME) | What to do. Then list the
remaining actions and who must do each one. If everything is OK, say "Ready to hand
in" with the commit hash on origin.
```
