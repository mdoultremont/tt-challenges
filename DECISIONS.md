# DECISIONS — your build log

Keep this as you go, not from memory at the end. Alongside your code and [PROMPTS.md](PROMPTS.md), it's the main thing we read. Short and honest beats polished.

> If you're building with an AI agent, it's been asked ([CLAUDE.md](CLAUDE.md)) to pause at key decision points and put the call to **you** — use case, cuts, data model, pipeline shape, grounding, the trust surface. It records your answers **verbatim**; the *"in your own words"* lines below are for **your keyboard only** — your agent has been told not to write them. To be straight about why: we don't mind who typed this file, but the thinking has to be yours, and the review is where we check — we'll probe these decisions live and cross-reference the quotes against your raw session transcript. A messy honest log beats a polished generated one, every time.

## How to run what I built

Exact steps from a clean clone. We follow these literally.

Needs Docker, Node 22+ and pnpm 9.

```bash
cp .env.example .env        # then paste your ANTHROPIC_API_KEY
make up                     # Postgres+pgvector, MinIO, ElasticMQ
pnpm install
pnpm --filter @second-brain/api db:migrate   # apply the schema
pnpm --filter @second-brain/api db:seed      # DAW Capital fund + PC1/PC2/PC3 portcos
pnpm dev                    # frontend, API and ingestion worker together
```

- Frontend: http://localhost:3000, API: http://localhost:8787. Ctrl-C stops all three processes.
- The bucket and queue are created on first use, so there is no separate setup step.
- The seed creates only the fund and portco records. Documents are added by uploading Markdown files from `data/` in the UI, on the fund page or a portco page.
- The first ingestion downloads the local `Xenova/all-MiniLM-L6-v2` embedding model into `./.cache/huggingface`, so the first document takes longer.

## The use case I chose

Which document your brain generates (profile / comparison / brief / other), and why — who is it for, what decision does it support? (This is where reading [context-brain/](context-brain/) shows.)

## Decisions & trade-offs

### Decision: Fund and portco scoped knowledge model
- **The call:** Store fund and portco as first-class records. Every document and chat carries a fund ID and an optional portco ID. Fund chats can retrieve fund documents and all portcos in that fund; portco chats can retrieve only that exact portco.
- **Said at the time:** "I think we could do something like fund and portco. This would make sense in a sense of a document could be linked to a fund or a portcrow and the scope would be different depending on where you ask it from."
- **What I gave up:** A generalized organization and many-to-many document scope model in the first slice.
- **In your own words (typed by you, not your agent):**

### Decision: Persist before publishing ingestion work
- **The call:** Upload the object and persist the document as `queued` before publishing a small document ID message to ElasticMQ. If publication fails, retain the object and row, mark the document `failed`, and surface the failure for retry.
- **Said at the time:** "Queue for triggering the file ingestion with SQS"
- **What I gave up:** Immediate processing and automatic cleanup on queue failure.
- **In your own words (typed by you, not your agent):**

### Decision: Local Markdown embeddings
- **The call:** Use LangChain's Markdown-aware recursive splitter with 800 character chunks and 100 character overlap, then embed locally with `Xenova/all-MiniLM-L6-v2`. Keep exact source text and offsets in chunks, and retain YAML frontmatter as metadata.
- **Said at the time:** "for chunking I think we can use a markdown aware chunking and maybe keep the titles in the metadata ?"
- **What I gave up:** Hosted embeddings and broader Office/PDF ingestion in this slice; the first model load is slower while weights download locally.
- **In your own words (typed by you, not your agent):**

### Decision: Grounded answers through LangChain Anthropic
- **The call:** Use LangChain's Anthropic integration with structured output, local vector retrieval, and persisted citation snapshots. Treat source text as untrusted data and return insufficient evidence when citations are missing or invalid.
- **Said at the time:** "we should make the call to anthropic trhough langchain"
- **What I gave up:** Streaming answers and broader agent actions in this slice.
- **In your own words (typed by you, not your agent):**

### Decision: Follow-up retrieval searches the whole conversation
- **The call:** Each answer searches with every user question in the chat, joined newest first. The local embedding model truncates long input, so if anything is cut it is the oldest question. Assistant answers are left out of the search text. The model still sees the last 10 messages as conversation history.
- **Said at the time:** "It should search on the whole conversation for now". When the truncation limit was raised, the chosen option was "User turns, newest first (Recommended)".
- **What I gave up:** Query rewriting with an extra model call, which handles pronouns and topic changes better. A chat that changes subject will blend both topics into one search.
- **In your own words (typed by you, not your agent):**

### Decision: Follow-ups answered inline, failures retried explicitly
- **The call:** `POST /chats/:chatId/messages` saves the follow-up and answers it in the same request. If the model fails, the question stays saved, the API returns 503, and `POST /chats/:chatId/answer` retries it. A new message is refused (409) while a question is still unanswered, and the check holds a row lock so two concurrent sends cannot both pass. The chosen reader experience for a failure: "Inline retry".
- **Said at the time:** "Inline retry"
- **What I gave up:** Answering in the background through the queue, and streaming.
- **In your own words (typed by you, not your agent):**

### Decision: Sources shown as inline markers with a checkable list
- **The call:** Each answer shows numbered markers ([1], [2]) after its claims and a numbered source list below it: document title, section path and line range. Clicking a marker or a list row opens the exact excerpt that was cited. The backend renumbers the model's evidence labels (S3 → [1]) before saving, so the markers in the text match the list order.
- **Said at the time:** "if sources are used, we should be able to display them". Chosen options: "Inline markers + list" and "Yes, renumber in backend".
- **What I gave up:** A side panel with more room for evidence, and a cleaner reading view without markers. Answers saved before this change keep their S-labels as plain text.
- **In your own words (typed by you, not your agent):**

### Decision: Retry sits under the unanswered question
- **The call:** A question whose answer failed stays in the thread with the error and a Retry button directly under it, and the follow-up box is disabled until it is answered. A new chat, a reload, or a question added from another tab gets one automatic answer attempt. A follow-up that failed while answering waits for Retry instead. A message that never reached the server goes back into the box with an error.
- **Said at the time:** "if errors occur, we should allow users to retry their message". Chosen option: "Under the question".
- **What I gave up:** Automatic retries with backoff, and editing a failed question before retrying it.
- **In your own words (typed by you, not your agent):**

### Decision: Generate an executive brief for the deal partner
- **The call:** The generated document is an executive brief on one named leader at one portco. Its reader is the deal partner / IC chair (Dana Deline). It is built as a standalone artifacts module that the chat can call later.
- **Said at the time:** "exec brief is good" and, after asking what `context-brain/` says about the reader, "Okay so we need to produce the artifact for Dana ? let's do that"
- **What I gave up:** Candidate profiles and search comparisons (the corpus has closed searches and no reference calls to build them from) and the portfolio-wide talent review in this slice.
- **In your own words (typed by you, not your agent):**

### Decision: Exec brief grounding — per-section retrieval, per-claim citations, visible gaps
- **The call:** Retrieval runs one search per brief section (verdict vs target, each scorecard dimension, flight risk and succession, results vs value-creation plan), each naming the executive and role, restricted to the executive's portco and deduplicated. The model returns claims per section, each with its own source labels; code drops any claim whose labels are missing or invalid, and each kept claim is stored with its citation. A section left with no valid claims stays in the brief as a visible "no evidence" gap; if the executive cannot be found in the portco, nothing is generated or saved.
- **Said at the time:** "recommended for all"
- **What I gave up:** Exact name matching across all chunks (more recall, more noise), and a cleaner-looking brief that hides empty sections.
- **In your own words (typed by you, not your agent):**

### Decision: Exec brief trust surface, inline generation, re-ingested output
- **The call:** Each brief section carries an evidence strength computed in code from the number of distinct source documents behind it (0 = gap, 1 = single source, flagged; 2+ = corroborated), plus the type and date of each source so independent assessments read differently from management material. The brief stores metadata (executive, role, portco, generated at, model, prompt version, source list) and model-written flags that must cite a source or are dropped. No overall confidence score. Generation runs inline in `POST /artifacts`; a model failure returns 503 and saves nothing. The brief is rendered to Markdown, stored in MinIO as a `generated` document and sent through the existing ingestion queue so later chats can cite it; retrieval for a new brief excludes `generated` documents to avoid citing earlier briefs as evidence.
- **Said at the time:** "yes recommended"
- **What I gave up:** A single confidence number, async generation with a visible "generating" status, and letting briefs build on earlier briefs.
- **In your own words (typed by you, not your agent):**

### Decision: Briefs are requested from the chat
- **The call:** The chat model is bound to two LangChain tools, a grounded answer and exec brief generation, and must call one, so asking "Generate me an exec brief on …" creates and saves the brief without an extra model call for ordinary questions. The reply summarises evidence strength and flag count and links the saved brief. In a fund chat, the portco is chosen from the companies whose documents mention the name; when several do, the brief is not generated and the user is asked which company. (Tool routing and the fund-chat portco rule were agent defaults, not discussed.)
- **Said at the time:** `Let's just wire it into langchain so that the user can ask "Generate me an exec brief on Xxxx"`
- **What I gave up:** A separate "Generate brief" button with explicit inputs, and generating across portcos for someone who appears in more than one.
- **In your own words (typed by you, not your agent):**

One block per significant decision (the checkpoint ones at minimum — use case, cuts, data model, pipeline shape, grounding, trust surface):

```
### Decision: …
- **The call:** what you chose
- **Said at the time:** "…" (verbatim, captured by your agent from the conversation)
- **What I gave up:** the trade-off
- **In your own words (typed by you, not your agent):** why this was right
```

## What I cut

Where it landed, in my words: "I think the model makes sense, scoping can be improved but works like it should, users can upload documents to a specific scope, chat with the knowledge and generate documents".

What I left out, and why:

- **Deep modules.** "I like that way of doing things, but that necessitate more planning. You need to take time to do back and forths with the AI to reach out a shared understanding, otherwise you'll have to make the changes later. Had to do that because of time."
- **Planning.** "This challenge has been difficult because everything has to be done at the same time with little to no time for planning. Like in my previous point : I like to take more time on planning so that the execution can almost be one-shotted."
- **Features.** "auth, subscriptions, good design system, mobile version, other document types, other actions, better display when things are loading, adding specs, ... all of these are a bit out of scope but would be necessary on a real version."

Also not built from [SPEC.md](SPEC.md): the dashboard pillar, streaming answers, async brief generation with a visible status, and ingestion of anything other than Markdown/text.

## If I had another day

Two or three sentences: what you'd build next, harden, or test — and the first thing you'd ship.
