# PROMPTS — your AI trail

How you drive AI tools is part of what we assess — we *want* you using them, and we want to see how. Keep this honest and lightweight: paste or export the exchanges that mattered, as you go.

This includes the **questions you asked** — of the [context-brain/](context-brain/), of your tools about the problem itself, of us by email. An engineer interrogating "who is this for and what makes it trustworthy?" before building reads very differently from one who opened with "build the thing."

For each significant exchange, a short entry like:

```
## [time] tool: claude-code
**Asked:** paste or summarize the prompt
**Got:** one line on what came back
**Did with it:** took it / rejected it because … / redirected it by …
```

What we're reading for:

- What you **delegated** to the tool vs. kept for yourself
- Whether you **verified** its output before building on it (and how)
- Where you **overrode or redirected** it — the moments the tool was wrong and you caught it
- What you asked to **understand the customer and the problem**, not just to produce code

**Commit the raw session export too.** Claude Code, Cursor, and friends can export full session transcripts — drop them in `prompts/` as-is. **We treat the raw log as the source of truth** and this file as your annotated index on top of it. Don't sanitize the export: dead ends, tool errors, and wrong turns read as experience, not failure. A trail with no wrong turns and no timestamps reads as reconstructed — the only bad version of this file.

> **If you use Claude Code, this is already wired up for you.** A `Stop` + `SessionEnd` hook (`.claude/settings.json` → `scripts/export-transcript.sh`) copies each session's full transcript into `prompts/raw-session-<id>.jsonl` automatically — no manual export. Just commit what lands there. On another tool, export by hand into the same folder. Either way, the raw logs are yours and we read them; the hook only removes the step where you forget.

---

*(your entries start here)*

Raw transcripts are in [prompts/](prompts/). The work ran across three main threads until they stopped for lack of credits: one to question `context-brain/` about decisions, one for backend changes, and one to parallelise frontend work.

Two caveats on the trail itself:

- **The timestamps aren't really relevant.** "I'd say I took a bit more time than needed to produce this result (a bit more than 3 hours total). I was on and off my computer lots of times." Elapsed time in the logs is much longer than time spent building.
- **The Codex threads were exported by hand.** I tried to hook into the Codex hooks to do the same automatic export as Claude Code, and it didn't really work.

## Sequence

## tool: claude-code / codex, context-brain thread
**Asked:** Questions to `context-brain/` before building, starting with which scope documents should have (fund or portco), and later who the generated artifact is for.
**Got:** The fund/portco scoping model and Dana Deline (deal partner / IC chair) as the reader of the brief.
**Did with it:** Took both. See the "Fund and portco scoped knowledge model" and "Generate an executive brief for the deal partner" entries in DECISIONS.md.

## tool: claude-code / codex, scaffolding
**Asked:** Main scaffolding of the app: TanStack Router frontend, Hono backend, Hono RPC between the two.
**Got:** The pnpm workspace with `apps/frontend` and `apps/backend`.
**Did with it:** Kept it. Then spent more time than planned on how documents, portcos and funds relate in the frontend.

## tool: claude-code / codex, ingestion
**Asked:** Document ingestion: save the document first, then chunk and embed it with local models.
**Got:** Upload to MinIO, queued row, ElasticMQ message, worker that chunks and embeds with `Xenova/all-MiniLM-L6-v2`.
**Did with it:** Kept it. See "Persist before publishing ingestion work" and "Local Markdown embeddings".

## tool: claude-code / codex, chats
**Asked:** Send a first chat message and wire it to answers, then link chats to documents.
**Got:** Grounded answers through LangChain Anthropic with citations, follow-ups and retry.
**Did with it:** Redirected several details (whole-conversation retrieval, inline retry, source markers). See the chat entries in DECISIONS.md.

## tool: claude-code / codex, artifacts
**Asked:** Generate an "Exec brief" document, then make it requestable from the chat.
**Got:** The exec brief module with per-section retrieval, per-claim citations, evidence strength and flags.
**Did with it:** Kept it and wired it into the chat as a LangChain tool.

## tool: claude-code / codex, final UX pass
**Asked:** Quick final UX improvements.
**Did with it:** Small fixes only; no new features.

## Retrospective

On parallelising: "Due to the fact that it's a starting of the project and that lots of things are moving around, it's really difficult to parallelize bigger chunks of work. It should be easier to do when the codebase becomes more mature and bigger."

On what was hard: "The biggest challenges were about time management. Trying to jump between my baby, api keys with antropic, new topics where I was less familiar and my small codex subscription that melts quickly. Parallelizing work is quite difficult in the beginning because 1 topic touches a lot of parts of the codebase."
