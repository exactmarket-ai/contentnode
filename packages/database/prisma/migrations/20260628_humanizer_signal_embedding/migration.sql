-- HumanizerSignal: document type tagging + pgvector embedding for few-shot retrieval

ALTER TABLE "humanizer_signals"
  ADD COLUMN "document_type" TEXT,
  ADD COLUMN "embedding" vector(1536);

-- HNSW index for cosine similarity search (works on empty table; IVFFlat requires ≥100 rows)
-- Add after first batch of embeddings are computed if query latency becomes a concern:
-- CREATE INDEX humanizer_signals_embedding_hnsw ON "humanizer_signals"
--   USING hnsw ("embedding" vector_cosine_ops);
