# Retrieval eval baseline

Run: 2026-10-24T10:49:14.263Z · embedding=gemini-embedding-001(768d) · topK=5

| Metric | Value |
| --- | --- |
| hit@1 | 100% (14/14) |
| hit@3 | 100% (14/14) |
| MRR | 1.000 |
| avg embed latency | 400 ms |
| avg pgvector latency | 291 ms |

| Threshold | On-topic coverage | Off-topic rejection |
| --- | --- | --- |
| 0.30 | 14/14 (100%) | 0/2 (0%) |
| 0.35 | 14/14 (100%) | 0/2 (0%) |
| 0.40 | 14/14 (100%) | 0/2 (0%) |
| 0.45 | 14/14 (100%) | 1/2 (50%) |
| 0.50 | 14/14 (100%) | 2/2 (100%) |
| 0.55 | 14/14 (100%) | 2/2 (100%) |
| 0.60 | 14/14 (100%) | 2/2 (100%) |
| 0.65 | 14/14 (100%) | 2/2 (100%) |
