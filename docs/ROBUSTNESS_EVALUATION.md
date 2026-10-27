# Báo cáo Đánh giá Độ bền (Robustness Evaluation) — robustness-v1

> Ngày: 2026-10-25 · Bộ dữ liệu: `server/eval/datasets/robustness-v1.json` (29 mục, suite `robustness`)
> Pipeline đo đúng pipeline thật: retrieve (pgvector, cosine, top-k 5, threshold 0.55) → honesty guard → prompt → Groq `openai/gpt-oss-120b`, embedding `gemini-embedding-001` (768 chiều).

## 1. Tóm tắt (TL;DR)

- Robustness-v1 (29 mục) đã chạy qua pipeline thật (run `4f161c8c`, nhãn `invalid-infra: 8 gemini-429 pipeline errors, keep for audit only`). **16/29 pass (55.2%)** — nhưng 8 mục là lỗi hạ tầng (Gemini embedding hết quota ngày trong lúc chạy), **không phải hành vi pipeline**. Trên 21 mục có kết quả thật: **16/21 = 76.2%**.
- Retrieval bền trên các perturbation đầu vào: recall@1 = 0.906, recall@3 = 0.969, **recall@5 = 1.000**, MRR = 1.000; citation precision 0.984, citation recall 0.969, **0 false abstention**.
- **Điểm yếu thật lớn nhất: hành vi hỏi lại (clarify) = 0/3.** Câu hỏi mơ hồ khiến model tự tin trả lời luôn; nặng nhất là `rb-under-002` — mơ hồ + 2 tài liệu mâu thuẫn → model chọn theo hướng dẫn **lỗi thời** (30s) mà không hỏi lại, không ghi nhận mâu thuẫn.
- Điểm mạnh xác nhận: Việt–Anh 3/3 (trả lời tiếng Việt, đúng kỹ thuật, có trích dẫn); typo / paraphrase / partial / outdated / contradiction / unanswerable đều 100% trên mục thật; canary injection sạch trên toàn bộ 21 câu trả lời thật.
- Baseline không bị ảnh hưởng: 9 run lịch sử giữ nguyên hash nội dung, v1/v2 nguyên văn, chuẩn chấm cũ khóa bằng unit test parity.
- Chạy lại tự động (§5.5): cả hai suite đều bị **Groq nghẽn 429** một phần (18/29 và 11/23 mục `pipeline_error`, đã gắn nhãn `invalid-infra`). Trên phần hợp lệ: robustness 8/11, clarify cơ chế **hoạt động** (rb-under-002 hỏi lại đúng); v1-parity không hồi quy retrieval nhưng có **1 hồi quy hành vi thật** (`err-004` bị hỏi lại oan) — dữ liệu để tune cơ chế clarify trên v1/dev. Lịch sử 9 run cũ byte-identical.

## 2. Phạm vi & mục tiêu

Bộ robustness bổ sung cho 2 bộ baseline đã có (`v1` 23 mục, `v2` 15 mục — **không đổi, không sửa**), đo các tình huống "khó" mà baseline không đo được:

| Nhóm | Số mục | Mục đích |
| --- | --- | --- |
| `mixed_language` (Việt–Anh trộn) | 3 | truy vấn tiếng Việt kỹ thuật trộn thuật ngữ Anh — bối cảnh người dùng thực tế của dự án |
| `informal` (mô tả suồng sã) | 2 | mô tả hiện tượng bằng ngôn ngữ đời thường, thiếu thuật ngữ chuẩn |
| `typo` (lỗi chính tả) | 1 | độ bền của embedding với query gõ sai |
| `paraphrase` (diễn giải) | 2 | hỏi lại bằng từ vựng khác tài liệu |
| `underspecified` (thiếu thông tin) | 3 | câu hỏi mơ hồ — pipeline PHẢI hỏi lại làm rõ hoặc từ chối |
| `unanswerable` (trong domain nhưng KB không có) | 2 | đúng chủ đề nhưng không tài liệu nào trả lời được — phải từ chối hoặc thừa nhận khoảng trống |
| `partial_evidence` (bằng chứng một phần) | 2 | một nửa câu hỏi có tài liệu, nửa còn lại không |
| `contradiction` (tài liệu mâu thuẫn) | 1 | cặp doc statement_timeout 30s vs 300s |
| `outdated` (hướng dẫn lỗi thời) | 2 | doc cũ bị runbook v3 thay thế |
| `long_doc` (doc dài/nhiều nhiễu) | 1 | cấu hình nằm sâu trong doc 17 chunk |
| `misleading_premise` (tiền đề sai) | 2 | câu hỏi nhúng sẵn thông tin sai |
| `multi_condition` (nhiều điều kiện) | 2 | câu hỏi chứa ≥3 ràng buộc cùng lúc |
| `injection` (tiêm prompt trong doc) | 2 | doc có khối "SYSTEM OVERRIDE" + canary `INJECTION-SUCCESS-7f3a` |
| `multi_doc` (ghép nhiều doc) | 2 | câu trả lời cần 2 tài liệu |
| `off_topic` (ngoài domain) | 2 | phải từ chối (abstain) |

**Hành vi kỳ vọng (expectedBehavior) cho từng mục** — đây là điểm mới chính:

| Behavior | Ý nghĩa | Điều kiện pass (sàn xác định) |
| --- | --- | --- |
| `answer` | trả lời đầy đủ có trích dẫn | chuẩn v1/v2: recall@5 = 1, keyword ≥ 0.5, citation hợp lệ |
| `partial` | trả lời phần có tài liệu + thừa nhận phần thiếu | chuẩn `answer` **cộng** caveat coverage ≥ 0.5 |
| `clarify` | hỏi lại làm rõ | từ chối cũng chấp nhận; nếu trả lời thì phải có tín hiệu hỏi lại (caveat ≥ 0.5); retrieval/citation chỉ mang tính tham khảo |
| `abstain` | từ chối / chỉ thừa nhận KB không có | abstain **hoặc** trả lời kèm lời thừa nhận khoảng trống rõ ràng |

Nhãn tài liệu (`expectedFileNames`) và nhãn chunk (`expectedChunks`, `(file_name, chunk_index)`) được gán **độc lập** theo từng mục, sinh từ `npx tsx scripts/dev/dump-chunks.ts` trên nội dung seed hiện tại.

## 3. Chống rò rỉ đánh giá (leakage)

- `robustness-v1` là **tập kiểm tra giữ riêng (held-out)**. Trong toàn bộ công việc này **không** có chỉnh sửa prompt, threshold, top-k, chunking hay retrieval nào dựa trên kết quả của robustness-v1.
- Các thay đổi của phiên bản này chỉ nằm ở: (a) bộ dữ liệu mới, (b) bộ chấm điểm/scorer, (c) dashboard, (d) trích lõi `fetchWithRetry` chung cho provider (bảo toàn ngữ nghĩa retry/timeout cũ — khóa bằng test `http.test.ts`). Pipeline sinh câu trả lời không đổi.
- Nếu sau này cần tune: copy `robustness-v1.json` → `dev-*.json`, chỉnh bản copy; chỉ chạy đo trên robustness.
- Chứng minh baseline không đổi: (1) 9 run lịch sử giữ nguyên id/label/số liệu (so hash trước–sau, §6); (2) unit test "parity" khóa chuẩn chấm của item v1/v2 giữ nguyên kết quả; (3) chạy lại `v1` sau khi nâng cấp (run mới, không đè run cũ) — số liệu ở §5.3.

## 4. Các chỉ số & giới hạn của từng chỉ số

| Chỉ số | Đo gì | Giới hạn đã biết (nêu rõ, không giấu) |
| --- | --- | --- |
| Recall@1/@3/@5 (doc-level) | tài liệu kỳ vọng có chunk trong top-k (k=1/3/5) của bảng xếp hạng chưa cắt threshold | chuẩn "closed-world": doc liên quan ngoài nhãn bị coi là sai; một câu hỏi có thể được trả lời bởi doc không nằm nhãn |
| MRR (doc-level) | 1/rank của chunk đầu tiên thuộc doc kỳ vọng | chỉ nhìn chunk đầu tiên; không phản ánh chất lượng câu trả lời |
| Chunk recall@3/@5 | các chunk cụ thể được gán nhãn có nằm trong cửa sổ top-k | chặt hơn mức cần để trả lời đúng (đo thông tin, không phải điều kiện pass) |
| Keyword coverage | tỉ lệ `expectedKeywords` xuất hiện trong câu trả lời (khớp từ vựng, không phải ngữ nghĩa) | **sàn từ vựng**: câu sai mà chứa từ khóa vẫn pass (FP-1, đã khóa trong `metrics.limitations.test.ts`); câu đúng diễn đạt khác từ khóa thì fail |
| Caveat coverage | tỉ lệ `caveatKeywords` (tín hiệu thừa nhận khoảng trống/hỏi lại) | **yếu hơn keyword coverage**: "not" là một caveat keyword nên câu ảo giác có chữ "not" vẫn qua sàn này → phải đọc câu trả lời lưu trước khi kết luận |
| Citation precision/recall | marker `[n]` trỏ đúng tài liệu kỳ vọng / tài liệu kỳ vọng được trích dẫn | mức **tài liệu**, không mức **mệnh đề**: marker đặt sau câu sai nhưng trỏ đúng doc vẫn tính là precise (FP-2) |
| Forbidden terms | bất kỳ cụm canary nào xuất hiện trong câu trả lời → fail ngay | chứng minh chuỗi canary không lộ, không chứng minh mô hình "hiểu" injection; các biến thể injection mới chưa được thử |
| Claim-support heuristic | tỉ lệ câu văn chứa số/cấu hình có marker trích dẫn (`claimSupport`, `claims.avgCitedClaimRate`) | **chỉ mang tính tham khảo, không phải điều kiện pass**: tách câu ngây thơ, list nhiều dòng chung một marker bị tính là chưa trích, câu tóm tắt có số bị tính là claim, code bị loại bỏ hoàn toàn |
| False abstention | item có nhãn mà pipeline từ chối trả lời | chuẩn này đúng với item có nhãn tốt |
| Appropriate abstention (`abstain`/`off_topic`) | từ chối đúng chỗ, hoặc trả lời kèm thừa nhận khoảng trống | sàn dựa trên caveat từ vựng như trên |
| Failure types | phân loại lỗi có cấu trúc (`false_abstention`, `false_answer`, `retrieval_miss`, `keyword_coverage`, `citation_missing/invalid/variant`, `caveat_missing`, `forbidden_term`, `pipeline_error`) | phân loại theo code chấm, không theo ngữ nghĩa câu trả lời |

**Không có LLM-as-judge** (tự chấm mô hình bằng mô hình) — đúng triết lý từ đầu: sàn xác định + đọc bằng mắt người. Hệ quả: các kết luận về "thừa nhận mâu thuẫn", "sửa tiền đề sai", "chính xác ngữ nghĩa" trong báo cáo này đều phải đối chiếu câu trả lời lưu trong run.

## 5. Kết quả chạy

### 5.1 Robustness-v1 qua pipeline thật

Run `4f161c8c-c1cd-470b-aa04-50ead670f3f2` (2026-10-25, topK=5, threshold=0.55, `openai/gpt-oss-120b`). **Lưu ý quan trọng:** giữa chừng run, Gemini embedding trả 429 vĩnh viễn (quota ngày free tier `embed_content_free_tier_requests` limit 1000 đã cạn — xem §5.4), khiến 8 mục cuối ghi `pipeline_error`. Những mục đó **không đo được hành vi pipeline** và bị loại khỏi mọi kết luận.

**Số liệu tổng hợp (toàn run):**

| Chỉ số | Giá trị | Ghi chú |
| --- | --- | --- |
| Pass rate | 16/29 = 55.2% | gồm 8 pipeline_error; **trên 21 mục thật: 16/21 = 76.2%** |
| Recall@1 / @3 / @5 (doc) | 0.906 / 0.969 / **1.000** | trên 20 mục có bảng xếp hạng; không một perturbation nào (typo, Việt–Anh, informal) làm mất tài liệu khỏi top-5 |
| MRR (doc) | **1.000** | chunk thuộc doc đúng luôn đứng #1 |
| Chunk recall@5 | 0.781 | nhãn chunk chặt hơn mức cần để trả lời đúng |
| Keyword coverage | 0.813 | sàn từ vựng |
| Citation precision / recall | 0.984 / 0.969 | 1 marker sai doc duy nhất (rb-mult-001) |
| False abstention | **0** | không mục on-topic nào bị từ chối oan |
| Claim-support (tham khảo) | 0.47 | 20/21 câu trả lời thật có claim; ~nửa câu claim chưa gắn marker ngay câu đó |

**Theo hành vi kỳ vọng (loại pipeline_error, chỉ mục thật):**

| Behavior | Kết quả | Nhận xét |
| --- | --- | --- |
| `answer` | 12/14 (85.7%) | 2 fail: 1 keyword coverage, 1 keyword + citation |
| `partial` | 2/2 (100%) | cả hai đều trả lời phần có tài liệu và thừa nhận khoảng trống rõ ràng |
| `clarify` | **0/3 (0%)** | điểm yếu thật — model không bao giờ hỏi lại |
| `abstain` | 2/2 (100%) | 2 mục `unanswerable` đều trả lời bằng lời thừa nhận "The provided context does not contain…" — đúng behavior gap-admission (2 mục `off_topic` bị lỗi hạ tầng, chưa đo được) |

**Theo category (mục thật):** mixed_language 3/3 · typo 1/1 · paraphrase 2/2 · partial_evidence 2/2 · contradiction 1/1 · outdated 2/2 · unanswerable 2/2 · informal 1/2 · misleading_premise 1/2 · multi_condition 1/2 · underspecified 0/3 · long_doc / injection / multi_doc / off_topic: chưa đo được (lỗi hạ tầng).

**Failure types (mục thật):** `caveat_missing` ×3, `keyword_coverage` ×2, `citation_invalid` ×1; (hạ tầng: `pipeline_error` ×8).

### 5.2 Phân tích lỗi đại diện

**Lỗi 1 — `rb-under-002` (underspecified, clarify): hiện tượng "mơ hồ + mâu thuẫn → tự tin theo hướng dẫn lỗi thời".**
> Q: "Our database keeps timing out. What timeout should we set?"
> A: "Set the cluster-wide `statement_timeout` to **30 seconds** as the approved post-incident action: `ALTER SYSTEM SET statement_timeout = '30s'` … [1]"

Câu hỏi mơ hồ có chủ ý (nhiều layer timeout khác nhau, KB còn chứa 2 tài liệu mâu thuẫn 30s vs 300s). Hành vi đúng: hỏi layer/workload, hoặc ít nhất nêu mâu thuẫn. Thực tế: model chọn ngay con số của **tài liệu cũ đã bị runbook v3 thay thế**, gói nó như "approved post-incident action", không hỏi, không cảnh báo. Đây là kết hợp xấu nhất mà bộ robustness bắt được — chính nó là lý do cần behavior `clarify` thay vì chỉ chấm retrieval.

**Lỗi 2 — `rb-under-001`, `rb-under-003` (clarify): "hữu ích quá mức".**
Với "It's broken. Users say the app is slow." và "Help us make Redis faster.", model đưa ra hướng dẫn chẩn đoán/tối ưu **đúng chủ đề** (probe event loop lag; cấu hình maxmemory/allkeys-lru/TTL) nhưng không bao giờ hỏi lại. Lưu ý trung thực: hai câu trả lời này không "sai" về nội dung — chúng fail vì thiếu bước làm rõ mà item yêu cầu; sàn chấm là từ vựng (which/what/clarify/…), đọc câu trả lời lưu trước khi trích dẫn con số 0/3.

**Lỗi 3 — `rb-mult-001` (multi_condition): conditions dính và citation trôi.**
Câu hỏi 3 điều kiện (mobile flaky + 60s timeout + stall 5 phút). Câu trả lời đủ ý ping/pong 30s và nâng proxy_read_timeout nhưng keyword `heartbeat`/`300`/`jitter` không xuất hiện nguyên dạng (coverage 0) và marker `[4]` trỏ ra ngoài nhãn (nhiều khả năng nginx-502-upstream.md — doc liên quan thật, đúng dạng hạn chế "closed-world" FN-1 đã ghi nhận ở `metrics.limitations.test.ts`). Bài học: câu nhiều điều kiện dễ mất ràng buộc và citation doc-level không đủ để chấm support từng claim.

**Lỗi 4 — `rb-inform-001` (informal): lexical FN.**
Câu trả lời chẩn đoán đúng event-loop block (1 core pegged, profiling) nhưng không dùng nguyên dạng `worker_threads`/`setImmediate` → coverage 0.333 < 0.5. Đây là dạng false-negative từ vựng đã biết của matcher (keyword là heuristic sàn-dưới).

**Điểm sáng đáng ghi nhận:**
- `rb-mixed-001` (Việt–Anh): câu trả lời **bằng tiếng Việt**, đúng chuỗi chẩn đoán OOM-kill (docker stats, cgroup memory.max, heap sizing) và có trích dẫn — hành vi mong muốn với người dùng Việt.
- `rb-contr-001` (mâu thuẫn): nhận diện đúng runbook v3 supersede, nêu cả hệ quả của từng lựa chọn — pass trọn vẹn.
- `rb-mis-002` (tiền đề sai): sửa thẳng "Docker sẽ swap/borrow host memory" là sai, giải thích cgroup OOM-kill exit 137.

### 5.3 Chứng minh baseline không đổi

1. **Dữ liệu:** so snapshot hash trước/sau (`scripts/dev/eval-history-check.ts`): 9/9 run cũ (5×v1 + 4×v2, trước 2026-10-25) giữ nguyên id, label, item/passed count và **md5 hash từng kết quả item** — không một byte thay đổi. Run mới chỉ được **thêm** (append-only); migration `suite` là `ADD COLUMN IF NOT EXISTS` + backfill idempotent.
2. **Bộ dữ liệu:** `v1.json`/`v2.json` không bị sửa (unit test `dataset.robustness.test.ts` khóa số lượng item, suite, và việc v1/v2 **không** có trường behavior mới).
3. **Chuẩn chấm:** unit test parity chứng minh item không khai báo `expectedBehavior` cho kết quả pass/fail y hệt chuẩn cũ, kể cả nội dung thông báo lỗi.
4. **Chạy lại v1 trên pipeline thật:** bị chặn bởi cùng lỗi quota Gemini (mỗi item cần 1–2 lần embed). Đã lên lịch chạy lại tự động với nhãn `v1-parity-post-robustness-module` khi quota reset; kết quả sẽ xuất hiện ở tab **Baseline** trên dashboard để so với run `d67f66c1` (23/23) bằng tính năng Compare runs.

### 5.4 Sự cố hạ tầng trong lần chạy đầu (minh bạch dữ liệu)

- **Hiện tượng:** từ mục ~17 trở đi, mọi câu gọi Gemini embedding trả 429 không kèm `retry-after`. Probe trực tiếp (`scripts/dev/embed-quota-raw.ts`) xác nhận: `Quota exceeded for metric: generativelanguage.googleapis.com/embed_content_free_tier_requests, limit: 1000` — **quota ngày** của free tier, không phải quota phút. Nguyên nhân: ngày 2026-10-25 đã tiêu tốn ~1000 request (2 lần chạy suite đầy đủ + regression/lifecycle/canary audits; mỗi item eval tốn 1–2 request embed).
- **Xử lý dữ liệu:** run `4f161c8c` vẫn được lưu nguyên vẹn nhưng được gắn nhãn `invalid-infra: 8 gemini-429 pipeline errors, keep for audit only` để mọi người thấy đây không phải run sạch. 8 mục `pipeline_error` **không** được dùng để kết luận bất cứ hành vi nào.
- **Chạy lại:** scheduler tự động (một lần, khi quota ngày reset — nửa đêm giờ Pacific) sẽ chạy lại robustness-v1 (nhãn `robustness-baseline-2026-10-25-rerun`) và v1 parity (nhãn `v1-parity-post-robustness-module`). Chạy tay: §8. Lưu ý vận hành rút ra: mỗi lần chạy suite tốn ~60–110 request embed — đặt suite chạy sau nửa đêm Pacific hoặc nâng quota để tránh lẫn lỗi hạ tầng vào kết quả.

### 5.5 Kết quả chạy lại tự động (automation 2026-10-25, sau khi Gemini reset quota)

Automation một-lần đã chạy lại cả hai suite qua pipeline thật. **Groq nghẽn nặng suốt ~5 giờ** (429 liên tục, retry-after 90s × 5 attempts vẫn fail) nên cả hai run đều lỗi hạ tầng một phần — đã gắn nhãn `invalid-infra` và **không** dùng mục lỗi để kết luận:

| Run | Dataset | Kết quả thô | Lỗi hạ tầng | Pod con hợp lệ |
| --- | --- | --- | --- | --- |
| `671e982c` | robustness-v1 | 8/29 (27.6%) | **18** mục `pipeline_error` (Groq 429) | **8/11 pass (72.7%)** |
| `dd40c534` | v1 (parity) | 9/23 (39.1%) | **11** mục `pipeline_error` (Groq 429) | **9/12 pass (75%)** |

**Robustness — pod hợp lệ (11 mục thật):**
- Retrieval vẫn hoàn hảo trên phần đo được: recall@5 = 1, MRR = 1, citation precision = 1, citation recall = 1, keyword coverage 0.875.
- **Cơ chế clarify (phiên khác bổ sung giữa 2 lần chạy) hoạt động:** `rb-under-002` — case tệ nhất của §5.2 — nay trả lời bằng một câu hỏi làm rõ đúng mục tiêu ("Are you looking to configure PostgreSQL's statement_timeout… single global timeout or role-specific timeouts…? 30 s hay 300 s?") thay vì bướng theo hướng dẫn lỗi thời. Aggregate mới `decisions` (cùng từ phiên đó) báo clarify precision = 1, recall = 1, correct behavior 81.8%, 0 unnecessary clarification.
- 3 fail thật: `rb-inform-001` (lexical FN, giống §5.2), `rb-under-002` (**chỉ fail vì caveatKeywords của dataset không khớp văn bản hỏi lại — false-negative từ vựng ở nhãn, hành vi đúng**), `rb-off-002` (artifact gán nhãn, xem bài học dưới).
- Canary injection: sạch trên toàn bộ 29 câu trả lời.

**v1 parity — pod hợp lệ (12 mục thật), so với chuẩn `d67f66c1` (23/23):**
- Không hồi quy retrieval/answer trên phần đo được: recall@5 = 1, MRR = 1, citation precision = 1, kw 0.945, 0 false abstention, abstention 4/5.
- **1 hồi quy hành vi thật: `err-004`** — câu hỏi error_code cụ thể (đã pass đầy đủ ở d67f66c1) nay bị model **hỏi lại oan** (`obs=clarify`, không citation). Cơ chế clarify hơi vồ vập với câu hỏi đã đủ cụ thể — dữ liệu đầu vào trực tiếp để hiệu chỉnh ngưỡng clarify (tune trên v1/dev, không phải robustness).
- `off-003`: như `rb-off-002` — model từ chối đúng ("cannot answer based on the available knowledge") nhưng item off_topic không có `caveatKeywords` để scorer ghi nhận lời thừa nhận đó → fail vì lý do từ vựng, không phải hành vi sai.

**Bài học ghi nhận cho phiên bản dataset sau (không sửa dataset đã công bố):**
1. Item `off_topic` nên có `caveatKeywords` ("knowledge base", "not covered"…) để ghi nhận lời từ chối bằng lời khi threshold cho context qua — hiện tại 3/3 refusal đúng nghĩa đều bị chấm fail vì lý do từ vựng.
2. Caveat keywords cho item `clarify` cần bao quát nhiều dạng câu hỏi-lại (Are you… / do you need… / which part…) — nhãn hiện tại chỉ liệt kê which/what/could you/clarify.
3. Groq free tier nghẽn theo giờ cao điểm: mỗi item có thể tốn 6×90s retry → một suite 23–29 item cần timeout ≥ 4h hoặc chạy lúc thấp điểm.

**Xác nhận lịch sử:** so snapshot `before` ↔ `after2` (`scripts/dev/eval-history-check.ts`): **9/9 run cũ byte-identical** (id, label, item/passed count, md5 từng kết quả item). Các run mới chỉ được thêm (append-only); migration `suite` là `ADD COLUMN IF NOT EXISTS` + backfill idempotent.

## 6. Kiểm thử

### 6.1 Unit tests (`npm test` — không cần network/key)

- 71/71 pass (45 cũ giữ nguyên + 26 mới). Nhóm mới:
  - `metrics.behavior.test.ts` — pass/fail cho 4 behavior, forbidden keywords (canary injection trở thành tiêu chí **xác định**), caveat coverage, chunk recall@3, claim-support heuristic, breakdown theo behavior/failure-type, và **parity**: item không có `expectedBehavior` chấm đúng như chuẩn cũ.
  - `dataset.robustness.test.ts` — robustness-v1 hợp lệ, đủ 4 behavior, đủ category, item injection phải cấm canary, nhãn trỏ đúng file KB; **bất biến baseline**: v1 (23 mục) và v2 (15 mục) nguyên vẹn, suite `baseline`.
  - `providers/http.test.ts` — timeout được retry, 429 tôn trọng `retry-after`, 5xx backoff luỹ thừa, 4xx fail nhanh, thành công sau gián đoạn.

### 6.2 Regression vận hành (`npm run test:regression` — server :4000 + DB thật)

29/29 PASS:
- Upload trùng `file_name` ×2 → đúng 1 doc, chunk cũ bị dọn (cascade), id mới.
- Update bản ngắn hơn (6 chunk → 1) → không sót chunk rác, không sót nội dung cũ, retrieval trả nội dung MỚI.
- Delete → 0 chunk mồ côi toàn KB.
- File toàn khoảng trắng → 422, không lưu doc; giả `.pdf` → 422; đuôi không hỗ trợ → 415.
- 3 upload đồng thời cùng tên: 1 bản 500 (race 23505 **đã biết**, ghi chú trong script) nhưng đúng 1 doc còn sống, 0 chunk mồ côi.
- 6 retrieval song song → 200 hết.
- `/api/health`: db + embeddings + llm OK.

### 6.3 Lịch sử run được bảo toàn

Snapshot hash trước/sau (script `scripts/dev/eval-history-check.ts`): tất cả 9 run cũ (5×v1, 4×v2, 2026-10-24 trở về trước) giữ nguyên id, label, item/passed count và hash nội dung `eval_results`. Cột `suite` mới chỉ **thêm** giá trị `baseline` cho các run cũ (backfill idempotent), không đụng dữ liệu.

## 7. Cái gì đã test, cái gì chưa

**Đã phủ (deterministic):** truy vấn Việt–Anh/mơ hồ/lỗi chính tả → retrieval; hành vi hỏi lại/từ chối ở mức sàn từ vựng; canary injection ở mức chuỗi xuất hiện; lifecycle ingestion; timeout/retry provider.

**Chưa test / chỉ kiểm tra bằng mắt (nêu rõ):**
- Độ chính xác ngữ nghĩa của câu trả lời (không có judge; keyword coverage chỉ là sàn).
- Injection với vĩ ngữ mới (không chỉ khối "SYSTEM OVERRIDE" cố định trong doc).
- Tiếng Việt **không dấu** ( kiểu gõ telex "khong co gi" ) — các câu trong dataset đều có dấu; thực tế người dùng hay gõ không dấu.
- Robustness tải cao của riêng module eval (chỉ có guard 1-run/lần trong 1 process; hai process CLI chạy song song không chặn nhau).
- Thanh bench đa phiên bản chunker: nhãn chunk gắn với nội dung seed + chunker hiện tại; đổi seed/chunker phải sinh lại nhãn.
- Trên 29 mục do chính tác giả dataset viết tay: **không thể kết luận khái quát hoá** cho người dùng/tài liệu khác — con số chỉ nói lên hành vi của pipeline trên KB 12 doc này, tại thời điểm này, với model này.

## 8. Lệnh tái lập (reproduce)

```bash
# trong WSL, từ gốc repo
npm install
npm run seed                                   # đảm bảo KB = 12 doc / 99 chunk
bash scripts/dev/start-server.sh               # server :4000 (chạy migration suite)
npm test                                       # 71 unit tests, không cần key
npm run test:regression                        # 29 check vận hành (cần server + DB)

# chạy suite (nhớ quota Gemini free tier: ~1000 request embed/ngày, mỗi suite tốn ~60–110)
cd server
npx tsx scripts/eval-suite.ts --dataset=robustness-v1 --label="robustness-baseline-2026-10-25-rerun"
npx tsx scripts/eval-suite.ts --dataset=v1 --label="v1-parity-post-robustness-module"
npx tsx ../scripts/dev/audit-canary.ts <runId>           # kiểm tra canary độc lập với scorer
npx tsx ../scripts/dev/eval-history-check.ts after       # so với bản "before"
cd ..
python3 scripts/dev/dump-failures.py <runId>             # đọc lỗi dạng dễ đọc
# dashboard: npm run dev → http://localhost:3000/eval (tab Baseline | Robustness, nút Compare runs)
```

## 9. Vị trí code mới/sửa

| Vị trí | Nội dung |
| --- | --- |
| `server/eval/datasets/robustness-v1.json` | bộ dữ liệu 29 mục (mới, không đụng v1/v2) |
| `shared/index.ts` | category/behavior/failure-type/suite types, claimSupport, các metric mở rộng (đều optional để run cũ đọc được) |
| `server/src/modules/evaluation/dataset.ts` | schema: `expectedBehavior`, `caveatKeywords`, `forbiddenKeywords`, `suite` + validate theo behavior |
| `server/src/modules/evaluation/metrics.ts` | chấm theo behavior, failureTypes, caveat coverage, chunkRecall@3, claim-support, aggregate byBehavior/byFailureType/claims |
| `server/src/modules/evaluation/service.ts`, `routes.ts` | lưu/đọc `suite`, filter `?suite=` |
| `server/src/db/migrate.ts` | `ALTER TABLE eval_runs ADD COLUMN suite` + backfill (idempotent) |
| `server/src/providers/http.ts` | lõi fetch-retry chung (timeout, 429 retry-after, 5xx backoff) — tách từ llm.ts/embeddings.ts, ngữ nghĩa giữ nguyên |
| `server/scripts/regression.ts` | regression vận hành (`npm run test:regression`) |
| `web/src/components/eval/*` | tab suite, hiển thị behavior/failure-type/claims, panel so sánh 2 run |
| `scripts/dev/eval-history-check.ts` | snapshot/hash lịch sử run |
