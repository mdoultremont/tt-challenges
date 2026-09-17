CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('candidate_profile', 'search_comparison', 'exec_brief', 'portco_brief');--> statement-breakpoint
CREATE TYPE "public"."document_source_kind" AS ENUM('seed', 'uploaded', 'generated');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TABLE "artifact_citations" (
	"artifact_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"citation_order" integer NOT NULL,
	"claim" text,
	"excerpt" text NOT NULL,
	CONSTRAINT "artifact_citations_artifact_id_chunk_id_pk" PRIMARY KEY("artifact_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chat_id" uuid,
	"type" "artifact_type" NOT NULL,
	"prompt_version" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "artifacts_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"portco_id" uuid,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"heading_path" text[] DEFAULT '{}' NOT NULL,
	"start_line" integer,
	"end_line" integer,
	"start_char" integer,
	"end_char" integer,
	"embedding" vector(384) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"portco_id" uuid,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"source_kind" "document_source_kind" DEFAULT 'uploaded' NOT NULL,
	"storage_key" text NOT NULL,
	"status" "document_status" DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processing_started_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_citations" (
	"message_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"citation_order" integer NOT NULL,
	"excerpt" text NOT NULL,
	CONSTRAINT "message_citations_message_id_chunk_id_pk" PRIMARY KEY("message_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portcos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portcos_fund_id_unique" UNIQUE("fund_id","id")
);
--> statement-breakpoint
ALTER TABLE "artifact_citations" ADD CONSTRAINT "artifact_citations_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_citations" ADD CONSTRAINT "artifact_citations_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_fund_portco_fk" FOREIGN KEY ("fund_id","portco_id") REFERENCES "public"."portcos"("fund_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_fund_portco_fk" FOREIGN KEY ("fund_id","portco_id") REFERENCES "public"."portcos"("fund_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portcos" ADD CONSTRAINT "portcos_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_citations_order_unique" ON "artifact_citations" USING btree ("artifact_id","citation_order");--> statement-breakpoint
CREATE INDEX "chats_scope_updated_idx" ON "chats" USING btree ("fund_id","portco_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_document_index_unique" ON "document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "document_chunks_document_idx" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_fund_created_idx" ON "documents" USING btree ("fund_id","created_at","id");--> statement-breakpoint
CREATE INDEX "documents_fund_portco_created_idx" ON "documents" USING btree ("fund_id","portco_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "funds_slug_unique" ON "funds" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "funds_name_id_idx" ON "funds" USING btree ("name","id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_citations_order_unique" ON "message_citations" USING btree ("message_id","citation_order");--> statement-breakpoint
CREATE INDEX "messages_chat_created_idx" ON "messages" USING btree ("chat_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "portcos_fund_code_unique" ON "portcos" USING btree ("fund_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "portcos_fund_slug_unique" ON "portcos" USING btree ("fund_id","slug");
