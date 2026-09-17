DROP INDEX "artifact_citations_order_unique";--> statement-breakpoint
ALTER TABLE "artifact_citations" DROP CONSTRAINT "artifact_citations_artifact_id_chunk_id_pk";--> statement-breakpoint
ALTER TABLE "artifact_citations" ADD CONSTRAINT "artifact_citations_artifact_id_citation_order_pk" PRIMARY KEY("artifact_id","citation_order");--> statement-breakpoint
CREATE INDEX "artifact_citations_chunk_idx" ON "artifact_citations" USING btree ("chunk_id");