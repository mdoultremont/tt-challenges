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

**An executive brief on one named leader at one portfolio company.**

The reader is the deal partner — Dana Deline, Managing Partner and IC chair in `context-brain/02-personas.md`. They never log in. They meet the product's output secondhand, in what the talent partner brings to a hiring decision or to a portco board. The decision it supports is the one made in that room: back this leader against the role target, or act on the gap. `context-brain/` is blunt about what they need — "a decision they can trust in about ten minutes, and evidence they can point to if it goes wrong" — and about what they can't afford: "being embarrassed at IC by a number they can't source".

So the brief is built to be interrogated, not just read. It answers the verdict against the role target, execution and results, the scorecard dimensions, flight risk and succession, and results against the value-creation plan. Every claim carries a citation that opens the exact passage it came from. Each section carries an evidence strength computed from how many distinct documents support it, so a corroborated section reads differently from one resting on a single piece of management material. Where the corpus is silent the section stays in the brief as a visible gap rather than being quietly dropped — that is the failure mode `context-brain/05-talent-review.md` warns about, "a confident number built on compromised evidence".

Briefs are requested from the chat ("Generate me an exec brief on …") because the person doing the asking is the talent associate or partner working a search, not Dana.

**In your own words (typed by you, not your agent):**
I chose this use-case by asking the context-brain about what would be the most useful document to generate for a user. Every other document should be as easy to generate as this one. I felt this one was a good first step in that direction.

## Decisions & trade-offs

### Decision: Fund and portco scoped knowledge model
- **The call:** Store fund and portco as first-class records. Every document and chat carries a fund ID and an optional portco ID. Fund chats can retrieve fund documents and all portcos in that fund; portco chats can retrieve only that exact portco.
- **Said at the time:** "I think we could do something like fund and portco. This would make sense in a sense of a document could be linked to a fund or a portcrow and the scope would be different depending on where you ask it from."
- **What I gave up:** A generalized organization and many-to-many document scope model in the first slice.
- **In your own words (typed by you, not your agent):** Every entities in the db should have a well defined scope. fund and portco are the two main things I found to scope on, but this could be extended to users, teams, or other entities.

### Decision: Persist before publishing ingestion work
- **The call:** Upload the object and persist the document as `queued` before publishing a small document ID message to ElasticMQ. If publication fails, retain the object and row, mark the document `failed`, and surface the failure for retry.
- **Said at the time:** "Queue for triggering the file ingestion with SQS"
- **What I gave up:** Immediate processing and automatic cleanup on queue failure.
- **In your own words (typed by you, not your agent):** Saving the doc before publishing to the queue allows for retries and better errror handling.

### Decision: Local Markdown embeddings
- **The call:** Use LangChain's Markdown-aware recursive splitter with 800 character chunks and 100 character overlap, then embed locally with `Xenova/all-MiniLM-L6-v2`. Keep exact source text and offsets in chunks, and retain YAML frontmatter as metadata.
- **Said at the time:** "for chunking I think we can use a markdown aware chunking and maybe keep the titles in the metadata ?"
- **What I gave up:** Hosted embeddings and broader Office/PDF ingestion in this slice; the first model load is slower while weights download locally.
- **In your own words (typed by you, not your agent):** There are lots of ways to chunk and embed text. I chose this one because it is simple, works well with markdown, and allows for local embedding without needing to call an external API. (which was part of the requirements, and Anthropic doesn't provide embeddings)

### Decision: Grounded answers through LangChain Anthropic
- **The call:** Use LangChain's Anthropic integration with structured output, local vector retrieval, and persisted citation snapshots. Treat source text as untrusted data and return insufficient evidence when citations are missing or invalid.
- **Said at the time:** "we should make the call to anthropic trhough langchain"
- **What I gave up:** Streaming answers and broader agent actions in this slice.
- **In your own words (typed by you, not your agent):** While langchain wasn't strictly necessary in this case, it added some structure to the AI part. It's also more scalable and allows for more complex actions in the future.

### Decision: Follow-up retrieval searches the whole conversation
- **The call:** Each answer searches with every user question in the chat, joined newest first. The local embedding model truncates long input, so if anything is cut it is the oldest question. Assistant answers are left out of the search text. The model still sees the last 10 messages as conversation history.
- **Said at the time:** "It should search on the whole conversation for now". When the truncation limit was raised, the chosen option was "User turns, newest first (Recommended)".
- **What I gave up:** Query rewriting with an extra model call, which handles pronouns and topic changes better. A chat that changes subject will blend both topics into one search.
- **In your own words (typed by you, not your agent):** The part I master the least here. I wanted to find the easiest solution quickly and didn't have time to explore better solutions. I think this is a good first step, but it can definitly be improved.

### Decision: Sources shown as inline markers with a checkable list
- **The call:** Each answer shows numbered markers ([1], [2]) after its claims and a numbered source list below it: document title, section path and line range. Clicking a marker or a list row opens the exact excerpt that was cited. The backend renumbers the model's evidence labels (S3 → [1]) before saving, so the markers in the text match the list order.
- **Said at the time:** "if sources are used, we should be able to display them". Chosen options: "Inline markers + list".
- **What I gave up:** A side panel with more room for evidence, and a cleaner reading view without markers. Answers saved before this change keep their S-labels as plain text.
- **In your own words (typed by you, not your agent):** Inline markers are a good first step to show evidence. While other solutions could be better depending on the use case, this is what I felt was the best for a starting point.

### Decision: Retry sits under the unanswered question
- **The call:** A question whose answer failed stays in the thread with the error and a Retry button directly under it, and the follow-up box is disabled until it is answered. A new chat, a reload, or a question added from another tab gets one automatic answer attempt. A follow-up that failed while answering waits for Retry instead. A message that never reached the server goes back into the box with an error.
- **Said at the time:** "if errors occur, we should allow users to retry their message". Chosen option: "Under the question".
- **What I gave up:** Automatic retries with backoff, and editing a failed question before retrying it.
- **In your own words (typed by you, not your agent):** Explicit failing message with retry button. That said, automatic retries could be a great addition for a first retry.

### Decision: Generate an executive brief for the deal partner
- **The call:** The generated document is an executive brief on one named leader at one portco. Its reader is the deal partner / IC chair (Dana Deline). It is built as a standalone artifacts module that the chat can call later.
- **Said at the time:** "exec brief is good" and, after asking what `context-brain/` says about the reader, "Okay so we need to produce the artifact for Dana ? let's do that"
- **What I gave up:** Candidate profiles and search comparisons (the corpus has closed searches and no reference calls to build them from) and the portfolio-wide talent review in this slice.
- **In your own words (typed by you, not your agent):** While these decisions are out of my confort zone, I felt that the executive brief was the most important and useful artifact to generate for the user.

### Decision: Briefs are requested from the chat
- **The call:** The chat model is bound to two LangChain tools, a grounded answer and exec brief generation, and must call one, so asking "Generate me an exec brief on …" creates and saves the brief without an extra model call for ordinary questions. The reply summarises evidence strength and flag count and links the saved brief. In a fund chat, the portco is chosen from the companies whose documents mention the name; when several do, the brief is not generated and the user is asked which company. (Tool routing and the fund-chat portco rule were agent defaults, not discussed.)
- **Said at the time:** `Let's just wire it into langchain so that the user can ask "Generate me an exec brief on Xxxx"`
- **What I gave up:** A separate "Generate brief" button with explicit inputs, and generating across portcos for someone who appears in more than one.
- **In your own words (typed by you, not your agent):** This was explicitly asked and is the most natural way to generate a brief. It also allows for a more natural conversation with the AI, and the user doesn't have to leave the chat to generate a brief. The loading state can definitly be improved as these actions can take a while to complete.

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

On pillar 4 (dashboard): the scope page is the only "state of the world" surface — the document list for a fund or portco, with live `queued` / `processing` / `ready` / `failed` status that polls while the pipeline is working, and generated briefs appearing in that same list. There is no separate dashboard answering "what's new, what needs me" across scopes.

Also not built from [SPEC.md](SPEC.md): streaming answers, async brief generation with a visible status, and ingestion of anything other than Markdown/text.

## If I had another day

I'd make sure to improve the UX. Changing the scope should be clearer. The chat experience should have a better feedback loop with mid-generation statuses for longer tasks. I'd also take time to clean the codebase. Deepening the modules so that adding new features would become easier. I'd also add some tests to be confident that new features would not break anything.
