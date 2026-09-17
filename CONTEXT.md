# Domain context

## Scope vocabulary

- A **fund** is the top-level knowledge owner. The seed fund is DAW Capital.
- A **portco** is a portfolio company owned by a fund. The seed portcos are PC1 (Vantage Managed Services), PC2 (Cascade Care Group), and PC3 (Ridgeline Freight & Logistics).
- A **document** belongs to exactly one retrieval scope: either the fund (`portco_id IS NULL`) or one portco. `fund_id` is always present.
- A **chunk** is a retrievable passage from a document. It preserves heading and line/character locations so a citation can be opened and verified.
- An **artifact** is a generated document persisted as a document with additional generation metadata and source citations.

## Retrieval policy

The chat scope is part of the chat row and is applied in the database query:

- Fund chat (`portco_id IS NULL`) retrieves fund documents and every portco document belonging to that fund.
- Portco chat (`portco_id = X`) retrieves only documents belonging to portco `X`; it excludes fund-level documents and all other portcos.

The composite fund/portco foreign keys keep a portco or chat from being attached to a different fund. Authentication and full access policy enforcement are outside this first slice.

## Embeddings

`document_chunks.embedding` uses 384 dimensions from the local `Xenova/all-MiniLM-L6-v2` model. Its output dimension and migration must remain aligned with `EMBEDDING_DIMENSIONS` in `apps/backend/src/db/schema.ts`.

## Ingestion worker lease

The worker claims a queued document atomically and sets it to `processing`. A duplicate delivery for a fresh processing, ready, or failed document is acknowledged without changing the attempt count. A processing claim older than four minutes is eligible for reclaim, which gives a crashed local worker a retry path while keeping the queue visibility timeout at five minutes. Deterministic source/chunk failures become `failed` and are acknowledged; database, storage, or model failures remain unacknowledged for queue redelivery.

## Document cleanup

Document deletion removes the database row and its chunks first. The corresponding MinIO object is then removed on a best-effort basis. If database deletion is rejected because durable citations still reference a chunk, the object is retained and the document remains available for evidence.

## Grounded chat

Chat answers retrieve only ready chunks in the chat's exact knowledge scope. The answer model receives labeled source passages and must return source labels for factual claims; invalid or missing citations produce the standard insufficient-evidence response. User messages are persisted before answering so model failures can be retried without losing the question.

Retrieval for an answer uses every user message in the chat, newest first, so follow-ups keep earlier context and embedding truncation drops the oldest turns. A chat accepts a new user message only when its latest message is an assistant answer; an unanswered message is retried through the answer endpoint.

## Executive briefs

An executive brief is the first artifact type (`exec_brief`). It is generated for one named executive at one portco, so `portcoId` is required and retrieval never leaves that portco. Generation refuses (422) before calling the model when no ready, non-generated chunk in the portco mentions the executive's name.

Retrieval runs one search per brief section and excludes `generated` documents, so a brief cites primary sources and never an earlier brief. The model returns claims with evidence labels; code drops any claim with a missing or unknown label and records how many were dropped. Every section is kept: a section with no supported claims is a visible gap. Evidence strength is computed from distinct source documents (0 gap, 1 single source, 2+ corroborated), and each source carries its document type, date and provenance class.

Generation is inline in `POST /artifacts`. The brief is stored as Markdown in MinIO and as a `generated` document, with the artifact row and one `artifact_citations` row per claim-to-passage link, in one transaction. The document is then published to the ingestion queue; a publication failure marks the document failed but keeps the brief. A chat can pass its `chatId` when it covers the portco (a fund chat or that portco's chat).

## Briefs from chat

A chat answer is one model call bound to two tools with `tool_choice: any`: `grounded_answer` for questions and `generate_exec_brief` when the latest message asks for a brief on a named person. A portco chat generates for its own portco. A fund chat picks the portco whose primary documents mention the name; a portco named by the user can narrow that list but never add a company without a mention, and several matches produce a question instead of a brief. The assistant reply summarises evidence strength and links the artifact through `messages.artifact_id`. Evidence problems become the reply; model or storage outages fail the answer so it can be retried.
