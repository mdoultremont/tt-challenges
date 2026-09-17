# Team Theory — Take-Home: Build the Second Brain

Welcome, and thanks for making the time. This is a **build challenge**: you get a product spec, a document corpus, empty infrastructure, and product context — and you build the product. There is no starter app. How you build it is the point.

## Why this exercise

Team Theory builds AI products for private-equity talent teams — software that turns the scattered record of how a fund hires and manages leaders into memory, judgment, and defensible decisions. We're hiring someone who can **build full-stack AI products end to end**: pipeline to prompt to pixel, with real product taste. This exercise is a small, honest sample of that job.

## What you're building

A working slice of **the Second Brain** for a fictional PE fund, DAW Capital. The full spec is in **[SPEC.md](SPEC.md)** — the short version:

1. **Ingest** — a file pipeline that takes the fund's documents (`data/`) into a searchable knowledge base.
2. **Converse** — a chat where a user asks questions and gets **grounded answers with citations**.
3. **Generate** — through conversation, the brain produces a **document** (a candidate profile, a search comparison, an exec brief — your pick), grounded in the knowledge base, with useful artifacts around it — and **saves it back into the knowledge base**.
4. **Dashboard** — a surface that makes the system legible at a glance.

The spec is deliberate about **what** and quiet about **how**. Your architecture, your schema, your agent wiring, your UX. **[STACK.md](STACK.md)** lists the technology families we work in (and the empty, pre-wired backing services you get); **[DESIGN.md](DESIGN.md)** gives light brand guidance. Inside those rails, build it your way.

## Before you build: understand the customer

**[context-brain/](context-brain/)** is a small knowledge folder about us — the company and mission, the product, who buys it, who uses it, and how a fund actually runs a search and a talent review. It exists so you can build for a real user instead of guessing.

**Interrogate it like a product manager would.** What decision does this document support? Who reads it? What would make them trust it? Ask it questions through your AI tools, or read it directly. And ask **us** questions too — reply to your invite email any time; we're your product owner and we answer fast.

Be aware: **the questions you ask — of the brain, of us — are part of what we read.** An engineer who interrogates the problem before building is exactly who we're looking for. Charging straight into code (or straight into "Claude, build the thing") without understanding who it's for is the failure mode this exercise is designed to surface.

## Quick start

You need Docker Desktop (or compatible), ~4GB free, and an **Anthropic API key** (Your Claude Subscription key would work too). Everything runs locally; nothing else is required.

```bash
git clone <your repo>
cd tt-challenges
cp .env.example .env     # paste your Anthropic key
make up                  # starts the backing services: Postgres+pgvector, MinIO, ElasticMQ
```

That gives you running, **empty** infrastructure (see [STACK.md](STACK.md) for ports and credentials). The schema, buckets, queues, services, and app are yours to create.

In a second terminal, install dependencies, apply the schema and seed the fund/portco records, then start the frontend, API, and ingestion worker together:

```bash
pnpm install
pnpm --filter @second-brain/api db:migrate
pnpm --filter @second-brain/api db:seed
pnpm dev
```

The frontend runs on `http://localhost:3000`, the API on `http://localhost:8787`, and `pnpm dev` stops all three processes together with Ctrl-C.

The first document ingestion downloads the local `Xenova/all-MiniLM-L6-v2` embedding model into `HF_CACHE_DIR` (default `./.cache/huggingface`). No hosted embedding service is used.

## Timebox — 2 to 3 hours

We mean it. A rough shape that works:

- **~20–30 min** — read SPEC.md, interrogate `context-brain/`, ask us anything, decide your use case and your cuts.
- **~1.5–2 hrs** — build the slice.
- **~15–20 min** — wrap: [DECISIONS.md](DECISIONS.md), [PROMPTS.md](PROMPTS.md), a final `make up`-from-clean check, push.

You will not build all four pillars *well* in that time — nobody can. **A thin slice that runs end to end beats two pillars gold-plated**, and what you choose to cut (recorded in DECISIONS.md) is graded as a product decision, not a shortfall. Don't gold-plate; stop at the timebox.

## Use your AI tools — and drive them

Build with whatever you'd actually use — Claude Code, Cursor, anything. We *want* to see AI-native building; it's how we work. Two things matter:

- **Keep the trail.** [PROMPTS.md](PROMPTS.md) holds the exchanges that mattered, and `prompts/` holds your **raw session exports** — we treat the raw log as the source of truth. We read both closely, and we'll dig into them in the review.
- **You own every line.** AI output you didn't verify, understand, or would not defend in review is the single failure mode we screen hardest for. The tool is leverage, not a subcontractor.
- **A word on authorship, since we're asking your agent to take notes:** we don't mind who *typed* DECISIONS.md — we care that the thinking is yours, and the review is where we check. We'll probe your recorded decisions live, ask for the counterfactuals, and cross-reference quotes against your raw transcript. That's why honesty is the winning strategy here: a messy, real trail defends itself; a polished, generated one collapses under one follow-up question.

## How we evaluate

We read your submission the way we'd read a founding engineer's first week:

1. **Does the slice work?** Clean clone → `make up` → your documented steps → ingest, converse, generate, save. We will run it.
2. **Full-stack judgment.** Sensible schema, a pipeline that handles failure, grounding that doesn't lie, a front end that holds together. How the multi-service pieces connect.
3. **Product taste.** The use case you chose and why, what earned the screen, whether the output would actually be trusted by the person it's for. This is where `context-brain/` pays off.
4. **The questions you asked.** Of us, of the brain, in your prompts — did you interrogate the problem like an owner?
5. **Decisions & honesty.** DECISIONS.md tells a coherent story: what you cut, why, and what you'd do next. Claimed-but-broken costs more than cut-and-said-so.
6. **How you drove the AI.** PROMPTS.md + commit history read as one story of delegation, verification, and override.
7. **How far you took it.** The spec is the floor, not the ceiling. The strongest submissions add something we never asked for, because the builder saw it mattered: a small design system or component library instead of default styling; a data model rethought from first principles rather than the obvious tables; an extra feature you can argue drives the business case; research beyond this repo on the ICP or the market that visibly shaped your calls. To be clear about the tension with "don't gold-plate": gold-plating is polishing what was asked for; taste is adding the unasked-for thing that matters. One of these done with intent beats all of them done thin, and none of them excuse a broken core slice.

No hidden tricks, no planted bugs, no points for suffering.

## How you finish — definition of done

You're done when your slice runs end to end, or the timebox is up — whichever comes first. Then:

1. Make sure a **clean clone + `make up` + your README-documented steps** brings your product up. (Add your run instructions to the top of DECISIONS.md or a `RUNNING.md`.)
2. **Commit and push everything** — code, `DECISIONS.md`, `PROMPTS.md`.
3. **Reply to your invite email** with the repo link, and **book the 60-minute review** (link in the same email).

**The review (60 min):** you demo what you built and walk us through the decisions; then we'll ask for one small live change to *your* codebase, together on your machine. Nothing to prepare beyond having it able to start.

---

*Everything here — the fund, the companies, the people, the documents — is fictional. No real client data. Have fun with it; we're looking forward to seeing what you build.*
