# Báo cáo Audit — RAG Technical Support Assistant (2026-10-24)

Audit sau khi bộ eval đạt 100% (run `d67f66c1`, 23/23 trên dataset v1, KB 7 docs). Mục tiêu:
kiểm chứng độ tin cậy của kết quả, không thêm tính năng lớn. Mọi phát biểu dưới đây đều có
bằng chứng truy vết được (run id, log, script tái lập được trong `scripts/dev/audit-*.ts`).

## Tóm tắt điều hành

**Kết luận chính: con số "100%" là thật trong điều kiện đo (dataset v1, KB 7 docs, code đúng
phiên bản) nhưng KHÔNG phải thuộc tính ổn định của hệ thống.** Audit tìm thấy 3 nhóm nguyên nhân:

1. **Vận hành**: một server process chạy code cũ (pre-fix) giữ port 4000 đã tạo ra run 11/23 —
   "100%" tái lập được qua script nhưng phá sản qua HTTP. Đã sửa `start-server.sh` + restart.
2. **Đánh giá**: evaluator có 5 blind spot (FP-1..4, FN-1) — được ghi thành test
   `metrics.limitations.test.ts`; thêm 2 false negative thực tế do matcher lexical (đã sửa 1).
3. **Hệ thống**: khả năng chứa đạo (abstention) suy giảm khi KB lớn lên — 5 doc mới làm
   off-topic score tăng +0.10, cửa sổ phân tách on/off thu hẹp còn **0.026** (0.691 → 0.717).

Không có thay đổi hành vi nào không được chứng minh bởi test. Baseline cũ được bảo toàn
nguyên vẹn trong DB (runs `8b8506a2`, `d67f66c1`).

## Kết quả theo trọng số ưu tiên

### P0 — Server process cũ phục vụ code pre-fix trên port 4000 [ĐÃ SỬA]

- **Bằng chứng**: run `98870c91` (16:14Z) đạt 11/23 với `config.threshold=0.5` và answer chứa
  raw `【n】` (normalizer không chạy) — trong khi run `d67f66c1` (15:58Z) đạt 23/23 với
  `threshold=0.55`. Log `/tmp/ragts-server.log` cho thấy process giữ :4000 boot lúc 14:10:24Z
  với `threshold=0.5`, trước khi fix được viết. Nguyên nhân: `start-server.sh` chạy `tsx src/index.ts`
  (không watch) và `pkill -f "tsx src/index.ts"` không khớp process `tsx watch src/index.ts`
  của `npm run dev` → hai cây process song song, bản cũ hơn giữ port.
- **Tái lập**: so sánh config hai run (`scripts/dev/audit-configs.ts`), đọc boot line trong log.
- **Fix**: `start-server.sh` giờ pkill khớp cả `tsx( watch)? src/index\.ts`; đã restart và xác
  nhận qua HTTP: câu K8s RBAC (off-003) giờ `sufficient=false` (0.55 hoạt động end-to-end).
- **Lưu residual**: giữa lúc audit, chính server này lại cũ so với working tree (enum category
  mới làm `GET /api/eval/datasets` 500) — đã restart lần 2. **Bài học vận hành**: chạy eval qua
  script (`npm run eval:suite`) luôn dùng code trên đĩa; chạy qua HTTP dùng code của process —
  phải restart sau khi đổi code khi chạy mode không watch.

### P0 — Abstention suy giảm khi KB lớn lên (khả năng mở rộng của threshold đơn) [PHÁT HIỆN, CHƯA SỬA CÓ CƠ SỞ]

- **Bằng chứng** (sweep `scripts/dev/audit-sweep.ts`, embedding deterministic):
  - off-003 (K8s RBAC): **0.506 trên KB 7 docs → 0.610 trên KB 12 docs** (+0.104, do doc mới
    nhắc Kubernetes/multi-tenant). Tại threshold 0.55, off-003 từ PASS (chặn đúng) thành FAIL
    (được trả lời) — run v1 trên KB mới: `25b72096` và `417899f2` đều 20/23.
  - 3 probe off-topic "gần chủ đề" mới (v2): streaming replication 0.615, Grafana 0.691,
    pg_upgrade 0.656 — cả 3 vượt 0.55 → **0/3 abstention** (runs `b49558fb`, `887984f9`).
  - Toàn cảnh trên KB 12 docs: on-topic min = 0.717 (typo-002), off-topic max = 0.691 → cửa sổ
    phân tách chỉ còn **(0.691, 0.717)**.
- **Phân loại chất lượng trả lời khi lọt**: 4/4 answer quan sát được đều trung thực (từ chối +
  nêu thiếu gì) trừ **một ca hallucinate** — off-007 (Grafana) bịa dashboard/alert threshold
  cụ thể từ mention lỏng lẻo trong context (run `b49558fb`).
- **Vì sao không bump threshold lên ~0.70**: cửa sổ 0.026 quá mỏng để tin cậy — typo-002 chỉ
  hơn 0.017; câu user thật (lỗi chính tả nhiều hơn) có thể rơi xuống dưới 0.70 → false
  abstention, lỗi nguy hiểm hơn lỗi hiện tại. Đã sửa bằng prompt ở P1, việc còn lại là kiến
  trúc (khuyến nghị P2).
- **Khuyến nghị**: (1) giữ 0.55; (2) cân nhắc "sufficiency judge" hạng nhẹ (kiểm tra top-k
  chunk có thực sự trả lời câu hỏi không) hoặc hybrid score (khoảng cách top1−top2, độ phủ
  thực thể) thay threshold điểm tuyệt đối; (3) mỗi lần thêm doc vào KB, chạy lại sweep —
  off-topic scores trôi lên theo kích thước KB.

### P1 — Prompt cho phép extrapolate từ mention ngẫu nhiên [ĐÃ SỬA + ĐO LẠI]

- **Bằng chứng**: off-007 ở run `b49558fb` trả lời câu Grafana bằng dashboard + alert rule +
  threshold 300ms/2× bịa hoàn toàn. Sau khi thêm 2 rule vào `SYSTEM_PROMPT` (đừng xây dựng
  khuyến nghị từ mention ngẫu nhiên; không bịa ngưỡng số/tên panel/tooling), run `887984f9`
  trả lời cùng câu chỉ với nội dung CÓ THẬT trong doc (event loop lag 100ms/1s, cite đúng [5])
  + section "What is missing".
- **Kiểm soát hồi quy**: v1 trước/sau prompt fix trên cùng KB: 20/23 → 20/23 (không có item
  nào xuống cấp; keywordCoverage 0.852 → 0.87, citationPrecision 0.972 → 0.986).

### P1 — Evaluator: các blind spot [5 mode, ĐÃ GHI THÀNH TEST]

File `server/src/modules/evaluation/metrics.limitations.test.ts` (chạy trong `npm test`, 45/45)
mô tả + khóa từng mode — nếu test fail nghĩa là scorer đã thay đổi hành vi:

| Mode | Loại | Mô tả |
| --- | --- | --- |
| FP-1 | False positive | Answer sai sự thật nhưng chứa đủ keyword → PASS (lexical, không có semantic grading) |
| FP-2 | False positive | Marker `[2]` trỏ đúng DOCUMENT nhưng sai CHUNK (claim không nằm trong chunk đó) → precision 1.0 |
| FP-3 | False positive | Claim bịa gắn đuôi vào answer đúng → vẫn PASS (không phát hiện unsupported claim) |
| FP-4 | False positive | Chỉ cite 1/2 doc kỳ vọng → vẫn PASS (citation recall không phải tiêu chí pass) |
| FN-1 | False negative | Marker trỏ tới doc hỗ trợ hợp lý nhưng không nằm trong `expectedFileNames` → FAIL |

- **FN-1 xuất hiện trong thực tế 2 lần** (fact-004, runs `98870c91` + `417899f2`): câu hỏi
  fact-004 hỏi cả `proxy_read_timeout` (nội dung nằm trong CẢ nginx-502-upstream.md) nhưng nhãn
  chỉ liệt kê websocket-drops.md → marker [4] hợp lý bị FAIL. Bài học ghi vào v2: **label mọi
  doc hỗ trợ, không chỉ doc chính**.
- **Soi tay PASS cases**: fact-002, multi-003 (run `d67f66c1`) — nội dung đúng, citation khớp
  claim (spot-check chunk thật). Toàn bộ 16 nhãn `expectedChunks` của v1 đối chiếu DB đều đúng.

### P1 — Matcher keyword bỏ sót biến thể ký tự [ĐÃ SỬA]

- **Bằng chứng**: fact-002 (run `25b72096`, answer đúng "5 – 10"/"5‑10" với U+2011 non-breaking
  hyphen — gpt-oss hay phát trong bold) bị FAIL keyword; contra-001 (run `b49558fb`, answer
  đúng "300 seconds"/"30-second") bị FAIL tương tự.
- **Fix**: `keywordHits` giờ fold hyphen ≈ space và normalize cả khối U+2010–U+2015/U+2212;
  keyword "5-10" khớp "5 – 10", "5‑10"; "per process" khớp "per-process".
- **Residual trung thực**: dạng từ-ở-giữa ("5 to 10" — run `417899f2`) không thể khớp bằng
  lexical matcher; đây là giới hạn gốc của heuristic keyword, chỉ giải quyết bằng LLM-judge
  hoặc normalization hiểu số. fact-002 sẽ dao động PASS/FAIL tùy cách model diễn đạt — **điều
  này chứng minh pass-rate từng item không phải đại lượng ổn định**.

### P2 — Adversarial dataset v2 [MỚI, ĐÃ CHẠY 2 LẦN]

`server/eval/datasets/v2.json` (15 items, 6 category mới) + 5 seed docs adversarial
(statement_timeout mâu thuẫn, slow-query-log thiếu nửa sau, graceful-shutdown cấy injection
canary, nginx-rate-limiting 17 chunks). Kết quả:

| Run | Pass | Ghi chú |
| --- | --- | --- |
| `b49558fb` (trước fix) | 11/15 | contra-001 fail keyword (lexical FN); 0/3 off-topic abstain; off-007 hallucinate |
| `887984f9` (sau fix) | 12/15 | off-topic vẫn 0/3 (đúng như thiết kế — threshold chặn trước LLM); off-007 hết bịa |

Phát hiện tích cực (tái lập được):
- **Prompt injection bị kháng** cả 2 run (canary scan `scripts/dev/audit-canary.ts` sạch;
  answer injection-001 đúng nội dung shutdown, cite đúng).
- **Typo**: 3/3 PASS, recall@5 = 1.0 — embedding chịu lỗi chính tả tốt (score thấp nhất 0.717).
- **Long doc**: 2/2 PASS, chunkRecall@5 = 1.0 — lấy được config nằm sâu chunk 9–10/17.
- **Contradiction**: retrieval đưa được cả 2 doc mâu thuẫn vào top-5; answer trích dẫn đúng
  300s + thừa nhận 30s cũ bị thay thế (soi tay run `b49558fb`).
- **Misleading premise**: 2/2 PASS — soi tay: model sửa cả 2 chi tiết sai trong premise
  (SQLSTATE đúng là 40P01, cùng-thứ-tự không deadlock).
- **Partial evidence**: PASS + soi tay xác nhận answer chỉ hướng dẫn phần slow log (đúng),
  phần còn lại không bịa.

### P2 — Document lifecycle [21/21 PASS]

Script `scripts/dev/audit-lifecycle.ts` bấm LIVE API + kiểm tra DB trực tiếp:

- Upload trùng tên (upsert): 201, đúng 1 doc, id mới, chunk cũ dọn sạch (cascade) ✓
- Update nội dung: chunk mới được index, không sót chunk cũ, retrieval thấy nội dung mới ✓
- File trắng toàn whitespace → 422, không sót row document ✓; giả .pdf (magic bytes) → 422 ✓;
  đuôi không hỗ trợ → 415 ✓
- Xóa doc → 0 chunk; quét toàn KB: **0 orphan chunk** ✓
- Quirk (chấp nhận, ghi nhận): upsert key `file_name` phân biệt hoa thường —
  `Doc.md` và `doc.md` là 2 doc riêng.
- Race 2 upload đồng thời cùng tên (`scripts/dev/audit-race.ts`, chạy 2 lần): luôn đúng 1
  winner (UNIQUE constraint bảo vệ integrity), nhưng **1 lần chạy có 1 upload nhận 500**
  (`23505 duplicate key`) thay vì 409 — lỗi race hiếm, tác động thấp (không hỏng dữ liệu),
  fix đề xuất: `INSERT ... ON CONFLICT` + retry hoặc advisory lock.

### P2 — Bảo mật

| Hạng mục | Kết quả | Bằng chứng |
| --- | --- | --- |
| Authentication | **Không có** — mọi endpoint anon | curl không credentials: GET documents/eval 200, DELETE chạy được (lifecycle test) |
| Phân quyền document / cô lập user | **Không tồn tại** (single-tenant) | Không có khái niệm user trong schema; mọi người thấy mọi doc |
| Secrets | Sạch | `web/` không có env file, grep không thấy key; `server/.env` gitignored; scan git history sạch (phiên trước) |
| Rate limiting | chat/retrieve 20/phút ✓ (20×200 + 1×429); eval 12/giờ; **documents KHÔNG có limiter chi phí AI** — upload tiêu tốn Gemini quota chỉ bị giới hạn bởi 300/15phút chung | `scripts/dev/audit-security.sh` |
| CORS | Chặn origin lạ (ACAO luôn là allowlist origin, không echo origin yêu cầu) ✓ | test trên |
| RLS | Bật trên 4 bảng (chặn anon-key Supabase REST) ✓; service role tự bypass (bình thường) | `migrate.ts` |
| Prompt injection | Kháng trong 2 run có doc độc ⊃ canary ✓ (xem v2) | canary scan |

**Kết luận bảo mật**: hệ thống là demo/portfolio single-user; mọi "lỗ hổng" trên là thiết kế
chấp nhận được trong ngữ cảnh đó nhưng PHẢI được liệt kê nếu ai đó định deploy công khai.

### P2 — Hiệu năng & chi phí (đo từ stored runs)

| Hạng mục | v1 @7docs (`d67f66c1`) | v1 @12docs (`417899f2`) | v2 @12docs (`887984f9`) |
| --- | --- | --- | --- |
| total P50 / P95 | 2.38s / 9.79s | 2.85s / 8.69s | 2.33s / 4.47s |
| embed P50 | 401ms | 411ms | 459ms |
| pgvector P50 | 304ms | 299ms | 293ms |
| llm P50 / P95 | 1.71s / 10.58s | 4.16s / 9.40s | 1.57s / 3.66s |
| tokens/query (prompt+completion, tb) | ~990 + ~455 | ~1030 + ~395 | ~940 + ~320 |

- Đuôi P95 gần như toàn bộ là LLM (gpt-oss reasoning, free tier) — embed + pgvector ổn định
  (~0.3s mỗi thành phần, P95 ≈ P50).
- Chi phí thực tế: **$0** (Groq + Gemini free tier). Để ngoại suy giá list: avg ~1.000 prompt
  + ~400 completion tokens/query, ~440 token embedding/query — nhân với đơn giá provider hiện
  hành (không报价 ở đây để tránh số liệu ảo).

## Trạng thái regression cuối

- `npm test`: **45/45** (35 cũ + 10 mới: recall@1/@3, folding keyword, limitations FP/FN, v2 dataset).
- `npm run typecheck`: server + web sạch.
- Retrieval-only baseline trên KB 12 docs: hit@1 14/14 (100%), hit@3 100%, MRR 1.000; sweep
  0.50+ chặn 2/2 off-topic golden (`server/eval/RESULTS.md` đã regenerate).
- Recall@1/@3 (mới đo trên mọi item labeled, KB 12 docs): **Recall@1 = Recall@3 = Recall@5 = 1.0,
  MRR = 1.0** trên cả v1 (runs 25b72096/417899f2) lẫn v2 — tức doc kỳ vọng luôn ở chunk hạng 1.
  **Giới hạn của các số này**: đo trên 31+12 câu hỏi hand-authored bám sát ngữ vựng của doc
  (trừ typo), trên đúng KB này, embedding deterministic; chúng không nói gì về truy vấn thật
  đa dạng hơn, và doc-level recall=1.0 không loại trừ chunk sai được lấy (chunkRecall@5=0.889
  trên v1 — đúng như thiết kế: doc đúng qua chunk khác).
- Baseline bảo toàn: mọi run cũ vẫn nguyên trong `eval_runs`; không dataset v1 bị sửa.

## File/sửa đổi trong audit

| File | Loại |
| --- | --- |
| `scripts/dev/start-server.sh` | fix pkill pattern (P0) |
| `server/src/modules/chat/prompt.ts` | +2 rule chống extrapolation (P1) |
| `server/src/modules/evaluation/metrics.ts` | recall@1/@3; keyword folding U+2010–U+2015/hyphen≈space; nonNull handled undefined |
| `shared/index.ts` | EvalCategory +6 adversarial; EvalRankingInfo/ItemMetrics/Aggregate +recallAt1/3 (optional, tương thích JSONB cũ) |
| `server/src/modules/evaluation/dataset.ts` | EVAL_CATEGORIES mở rộng |
| `server/eval/datasets/v2.json` | mới — 15 adversarial items |
| `server/seed/*` | +5 adversarial docs (KB giờ 12 docs/99 chunks) |
| `server/src/modules/evaluation/metrics.limitations.test.ts` | mới — 5 blind spot thành test |
| `*.test.ts` (metrics, dataset) | test mới cho recall@1/3 + folding + v2 |
| `web/src/components/eval/run-detail.tsx` | CATEGORY_LABELS cho 6 category mới |
| `scripts/dev/audit-{dump,configs,sweep,lifecycle,race,canary,security}.{ts,sh}` | công cụ audit tái lập được |
| `docs/EVALUATION.md` | cập nhật dataset v2 + recall@1/3 + giới hạn |

## Khuyến nghị tiếp theo (theo thứ tự)

1. Chạy v2 đều đặn sau mỗi thay đổi prompt/retrieval (cùng quy trình với v1); luôn canary scan.
2. Thiết kế sufficiency-check thay threshold đơn (P0 ở trên) trước khi KB lớn hơn nữa.
3. LLM-as-judge (hoặc NLI) cho claim-level citation support + semantic correctness — xóa dần
   FP-1..3; giữ keyword làm floor.
4. Nếu deploy công khai: auth tối thiểu + limiter cho upload + giới hạn quyền DELETE.
5. Upsert race: `ON CONFLICT` handling khi nào đụng (hiếm, không urgencies).
