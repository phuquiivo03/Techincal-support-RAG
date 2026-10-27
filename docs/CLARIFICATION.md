# Cơ chế Clarification (hỏi làm rõ) — báo cáo triển khai

*Ngày 2026-10-25 · Suite: `clarification-v1` · Đầy đủ dữ liệu run trên dashboard `/eval`*

## 1. Vấn đề

Trước thay đổi này, điểm **clarification của suite robustness-v1 là 0/3** (run `4f161c8c`): với các câu hỏi nhập nhằng ("DB cứ hay timeout, nên đặt timeout bao nhiêu?"), trợ lý **trả lời luôn** thay vì hỏi lại — tệ nhất là case rb-under-002 mù quáng áp dụng con số 30s từ tài liệu đã lỗi thời mà không thừa nhận mâu thuẫn.

Nguyên nhân nằm ở **kiến trúc quyết định**, không phải retrieval (hit@1 100%, MRR 1.0):

- Hệ thống chỉ có **một điểm quyết định duy nhất**: ngưỡng similarity 0.55. Không chunk nào vượt ngưỡng → abstain (không gọi LLM). Có chunk vượt ngưỡng → LLM **luôn** trả lời.
- `SYSTEM_PROMPT` chỉ có rule "insufficient → nêu phần thiếu", không có chính sách khi nào nên hỏi lại, cũng **không có kênh đầu ra** để mô hình diễn đạt `clarify` — vốn từ duy nhất nó có là "trả lời có thừa nhận thiếu thông tin" hoặc "trả lời luôn".

## 2. Thiết kế

### 2.1. Bốn behavior tường minh (machine-readable)

`ChatResponse` thêm trường `behavior` (`shared/index.ts`):

| Behavior | Nghĩa | Luồng xử lý |
| --- | --- | --- |
| `answer` | Câu hỏi đủ cụ thể, evidence chống lưng → trả lời đầy đủ có trích dẫn | LLM |
| `clarify` | Thiếu thông tin thiết yếu, các cách hiểu dẫn tới khuyến nghị **khác nhau về bản chất** → hỏi **một** câu hỏi nhắm đúng chi tiết còn thiếu | LLM |
| `partial_answer` | Trả lời được phần có trong KB (có trích dẫn) + nêu rõ phần không có + hỏi một câu follow-up | LLM |
| `abstain` | Không có evidence đủ → từ chối | **Không gọi LLM** (ngưỡng retrieval) hoặc LLM tự tuyên bố |

Không có schema mới: `EvalExpectedBehavior` bên eval đã tồn tại từ module robustness; chat-side map `partial_answer` ↔ `partial` khi so sánh.

### 2.2. Quyết định ở tầng nào? — 1 LLM call, hợp đồng đầu ra có cấu trúc

Vẫn đúng golden rule "single retrieve → prompt → answer", **không thêm LLM call nào**. Quyết định đến từ chính model thông qua **hợp đồng đầu ra bắt buộc**: dòng đầu tiên của completion phải là

```
BEHAVIOR: answer | clarify | partial_answer | abstain
```

Parser deterministic mới `server/src/modules/chat/behavior.ts` tách directive ra khỏi phần thân trả lời:

- Directive **thiếu hoặc sai giá trị** → fallback `behavior: "answer"` với toàn bộ text (đúng ngữ nghĩa pipeline cũ — lỗi format không bao giờ làm hỏng phản hồi).
- Directive **khai báo behavior nhưng thân rỗng** → throw → global error middleware trả JSON lỗi (xử lý graceful cho generation failure).
- Parser chỉ đọc **dòng đầu tiên khác rỗng**; `BEHAVIOR:` xuất hiện ở giữa text (kể cả trong code fence) không bị nhầm.

System prompt (`chat/prompt.ts`) được viết lại quanh một **DECISION PROCEDURE 6 bước áp theo thứ tự** (abstain nếu off-topic với mọi block → clarify nếu chỉ nêu triệu chứng mơ hồ ("slow/struggling/broken") mà không nêu component + vấn đề cụ thể → clarify nếu các block đưa hướng fix/giá trị **khác nhau hoặc mâu thuẫn** và câu hỏi không nói bối cảnh nào áp dụng → dùng error signature cụ thể trong history → partial_answer → answer). Kèm quy tắc tường minh **khi nào KHÔNG hỏi** (câu hỏi đã đủ cụ thể, history đã cung cấp chi tiết, thiếu detail chỉ ảnh hưởng tuning tùy chọn, topic không có trong KB). User message kết thúc bằng lời nhắc chạy DECISION PROCEDURE trước khi viết (instruction cuối cùng là instruction được tuân thủ tốt nhất).

### 2.3. History hội thoại

- Chat API vốn đã nhận `history`; **eval runner giờ truyền `item.history`** (trường mới trong dataset schema, tối đa 8 message) vào pipeline — điều kiện tiên quyết để test nhóm case "nhập nhằng giả: history giải quyết".
- Prompt có rule riêng: resolve đại từ/tham chiếu theo history **trước khi** kết luận thiếu thông tin; khi history chứa error/log signature cụ thể thì phải chọn fix khớp đúng signature đó, không được trả lời fix chung chung.

### 2.4. Trích dẫn & nguồn

Bất biến được giữ nguyên: `answer`/`partial_answer` bắt buộc có `[n]`; `clarify` không đưa ra tuyên bố về thế giới nên không cần trích dẫn, nhưng API vẫn trả `sources` (context đã retrieve) để UI/debugger hiển thị minh bạch. Normalize `【n】 → [n]` chạy như cũ trên phần thân.

## 3. Đánh giá — suite `clarification-v1`

Dataset mới 14 items, **suite riêng** (không đụng vào v1/v2/robustness-v1 — các dataset đã công bố giữ nguyên byte-by-byte, được khóa bằng test immutability). Phủ đủ 7 nhóm case yêu cầu:

| Nhóm case | Items | Behavior kỳ vọng |
| --- | --- | --- |
| Nhập nhằng thật (không component/không triệu chứng cụ thể) | cl-amb-001/002/003 | `clarify` |
| Thiếu môi trường/phiên bản/cấu hình (heap mà không nói limit container) | cl-env-001 | `clarify` |
| Tham chiếu ngữ cảnh không có sẵn ("lỗi như hôm qua") | cl-ref-001 | `clarify` |
| **Nhập nhằng + tài liệu mâu thuẫn/lỗi thời** (statement_timeout 30s vs 300s) | cl-conflict-001 | `clarify` |
| Nhập nhằng **giả** — history giải quyết (contextual) | cl-ctx-001/002 | `answer` |
| Đủ cụ thể, trả lời an toàn không cần hỏi | cl-safe-001/002 | `answer` |
| Trả lời một phần (nửa có trong KB, nửa không) | cl-part-001/002 | `partial` |
| Không trả lời được / off-topic | cl-abst-001, cl-off-001 | `abstain` |

### 3.1. chống "đạt chỉ vì có dấu hỏi"

Pass criteria của behavior `clarify` (metrics.ts) yêu cầu **cùng lúc**:

1. Model tự tuyên bố `BEHAVIOR: clarify` (machine-readable), **và**
2. Phần thân **chứa câu hỏi thật** (`?` trong prose — `?` trong code fence không tính), **và**
3. **Caveat coverage ≥ 0.5 trên `caveatKeywords` mà item gán nhãn = CHI TIẾT CÒN THIẾU** (ví dụ cl-env-001 gán `["memory","container","ram","how much","limit"]` — câu hỏi làm rõ phải nhắc giới hạn bộ nhớ của container). "Could you tell me more?" chung chung → fail `caveat_missing`.

Ngoài ra scorer phạt chéo: `clarify` trên item kỳ vọng `answer`/`partial`/`abstain` → failure type mới **`unnecessary_clarification`**.

### 3.2. Metrics quyết định (confusion matrix) — `behaviorDecisions` trong aggregate

| Metric | Định nghĩa |
| --- | --- |
| `clarificationPrecision` | Trong số các item pipeline ĐÃ hỏi, bao nhiêu thuộc nhóm bắt buộc hỏi |
| `clarificationRecall` | Trong các item bắt buộc hỏi, bao nhiêu được hỏi |
| `unnecessaryClarifications` | Hỏi oan trên item kỳ vọng answer/partial/abstain |
| `falseAnswersOnClarify` | Kỳ vọng clarify nhưng tuyên bố `answer` tự tin (danger mode: đoán thay vì hỏi) |
| `correctBehaviorRate` | Khớp chính xác observed == expected trên toàn bộ items |

`observedBehavior` được ghi vào từng `EvalItemResult` (fallback theo `sufficient` cho response cũ), hiển thị trên dashboard (`→ asked clarification` v.v.) cùng thẻ metric "Clarification decisions".

## 4. Kết quả

### 4.1. Hai run đã lưu trữ (prompt v1 → v2)

| Chỉ số | Run 1 `55725dee` (v1: behavior contract) | Run 2 `603826cb` (v2: + anti-merge/conflict rules) |
| --- | --- | --- |
| Pass rate | 9/14 (64.3%) | 10/14 (71.4%) |
| Clarify precision / recall | 1.00 / 0.33 (2 hỏi đúng / 6 phải hỏi) | 1.00 / 0.33 |
| False answers trên case phải clarify | 4 | 4 |
| Unnecessary clarifications | **0** | **0** |
| Correct behavior rate | 71.4% | 71.4% |
| partial_answer | 2/2 (cl-part-001/002, đúng behavior + trích dẫn + gap admission) | 2/2 |
| abstain | 2/2 (in-domain refusal + off-topic gate) | 2/2 |
| Contextual (history giải quyết nhập nhằng) | 1/2 | 1/2 |
| Retrieval / citation | recall@5 = 1.0, MRR 1.0, citation precision 1.0 | như run 1 |

Điểm cải thiện từ v1→v2: `cl-abst-001` (từ chối trung thực được công nhận sau khi sửa label quá hẹp). **Zero unnecessary clarifications ở cả hai run** — cơ chế không hỏi oan trên câu hỏi đã đủ cụ thể (đây là rủi ro lớn nhất khi thêm clarify, và nó được kiểm soát).

4 case còn fail ở cả hai run, cùng một gốc rễ — **model "trả lời nhánh"** (gộp mọi diễn giải thành một câu trả lời dài, coi đó là an toàn):

- `cl-amb-002/003` (Redis "struggling" / 502 "some requests"): obs=answer — model đưa checklist phủ mọi nhánh thay vì hỏi nhánh nào.
- `cl-conflict-001` (statement_timeout 30s vs 300s): obs=answer — model chọn số của runbook "supersedes" mà không hỏi workload.
- `cl-ctx-002`: trả lời đúng behavior nhưng sai trọng tâm — bỏ qua signature "prematurely closed connection" có trong history, đề xuất `proxy_read_timeout` (fix cho nhánh khác) → trượt keyword `keepalive`/`proxy_http_version`.

### 4.2. Phân tích nguyên nhân gốc & fix (2026-10-25, đợt 2 — clarify recall 0.33)

**Nguyên nhân gốc** (xác định bằng chứng từ hồ sơ lưu trữ của 4 case fail — dumps đầy đủ qua `scripts/dev/dump-forensic.mjs`):

1. **Quyết định không bao giờ được "tính"**: gpt-oss-120b gọi với `reasoning_effort: "low"` chỉ phát ~20 reasoning tokens trước khi viết — decision procedure trong prompt không có compute để chạy. Bằng chứng: (a) rule tường minh của prompt v2 ("covering all branches is still guessing") bị model **đọc nhưng không thi hành** — cl-conflict-001 trích dẫn [3][5] cả hai tài liệu mâu thuẫn rồi vẫn khuyến nghị 300s vô điều kiện; (b) recall giữ nguyên 0.33 qua hai phiên bản prompt (9/14 → 10/14 chỉ do sửa label cl-abst-001) — đổi chữ không đổi hành vi, nhất quán với "rule không được thực thi".
2. **Context đồng nhất làm câu hỏi trông "đáng trả lời"**: cả 4 case fail đều retrieve về **một tài liệu duy nhất** phủ mọi diễn giải (redis-oom-eviction với mọi symptom; nginx-502 với mọi biến thể fix), còn case clarify thành công (cl-amb-001) retrieve **4 tài liệu khác nhau** (điểm phẳng 0.65–0.69) — tính nhập nhằng tự hiển thị trong context. cl-conflict-001 thêm tầng tài liệu "tự tuyên bố supersedes" → model coi mâu thuẫn đã được giải quyết sẵn. cl-amb-003 khó nhất: câu hỏi trùng gần nguyên văn incident summary của chính tài liệu.
3. **Kênh history yếu hơn kênh context** (cl-ctx-002): signature chính xác nằm trong history nhưng retrieval theo câu hỏi trả về chunk thiên về timeout → model neo theo context.

**Đã loại trừ**: parser/fallback (cùng run quan sát được clarify/partial_answer/abstain khai báo đúng — cơ chế directive hoạt động; +8 unit test); scoring bug (đọc tay 4 câu trả lời — đúng là trả lời trực tiếp không hỏi); retrieval miss (recall@5 = 1.0 — tài liệu đúng được retrieve, vấn đề nằm ở cách model xử lý).

**Fix (tối thiểu, nhắm nguyên nhân 1 + 2, không hardcode case):**

- `providers/llm.ts`: `reasoning_effort` **"low" → "medium"** + `max_completion_tokens` 2048 → 3072 (reasoning tokens dùng chung ngân sách completion).
- `chat/prompt.ts`: giữ decision procedure, siết bước 2–3 — triệu chứng mơ hồ bao gồm "some requests fail" dù đã nêu component; **một tài liệu liệt kê từng fix cho từng tình huống cũng là divergence** ("coverage of every variant, not an answer to which one applies here").
- `evaluation/metrics.ts` + `shared/index.ts`: `behaviorDecisions` tính trên **eligible items** (loại `model == "error"` — lỗi hạ tầng/quota không đếp là thất bại chất lượng model), thêm `eligibleItems`/`pipelineErrors`.
- Dataset: `clarification-v2.json` — bản widening label của v1 (chỉ 2 item clarify thêm từ vựng discriminator tương đương; ids/câu hỏi/behavior kỳ vọng giữ nguyên byte) — vì câu clarify của model cho cl-conflict-001 hỏi đúng trục "guidance nào (30s/300s)" nhưng trượt từ vựng label "workload/oltp/reporting".

**Xác thực nhanh trên chính 4 case fail** (pipeline thật, sau fix):

| Case | Trước (run v1/v2 prompt) | Sau (medium reasoning) |
| --- | --- | --- |
| cl-amb-002 (Redis struggling) | answer — checklist 5 nhánh | **clarify** ✓ hỏi đúng: "OOM/eviction warnings hay high latency từ stampedes?" |
| cl-conflict-001 (statement_timeout) | answer — 300s vô điều kiện | **clarify** ✓ hỏi guidance nào, dẫn [1][4] 30s lẫn [3][5] 300s |
| cl-ctx-002 (history 502) | answer sai nhánh (proxy_read_timeout) | **answer đúng nhánh** ✓ keepalive `proxy_http_version 1.1` + `Connection ""` |
| cl-amb-003 (502 some requests) | answer — liệt kê mọi fix | vẫn answer (case khó nhất) — prompt bước 2–3 đã siết nhắm pattern này, chờ run lưu trữ xác thực |

Sentinel chống-regression quan trọng nhất được xác thực ngầm: cl-ctx-002 (kỳ vọng answer) **không** bị kéo sang clarify oan. Các sentinel còn lại (cl-safe-001/002, cl-part-001) nằm trong run lưu trữ đầy đủ.

**Run lưu trữ đầy đủ (tự động)**: robustness-v1 re-run bằng code đã fix đang chạy (automation từ phiên trước, launch 08:30 UTC sau khi fix vào đĩa); `clarification-v2` (label `clarification-fix-medium-reasoning`) và v1 parity chạy theo automation 45 phút khi quota TPD hồi. Kết quả sẽ được ghi tiếp vào mục này.

### 4.4. Run robustness held-out với code đã fix (run `671e982c`, 11:46 UTC) — bằng chứng một phần, bị quota cắt xén

Run re-run robustness-v1 bằng code đã fix lưu lúc 11:46 UTC nhưng **18/29 item bị pipeline error** (Groq 429 khi bucket TPD cạn giữa chừng) → đã relabel `invalid-infra`, KHÔNG dùng làm số liệu tổng thể. Giá trị nằm ở **11 item hợp lệ** (metrics mới tách đúng: `eligibleItems=11`, `pipelineErrors=18`):

- **rb-under-002 — case "0/3 clarify" gốc — giờ `observed=clarify`**: *"đang cấu hình statement_timeout per-query à — cần single global timeout hay role-specific? Điều này quyết định 30s cap hay 300s global áp dụng"* — hỏi đúng discriminator, nêu cả hai giá trị mâu thuẫn. Ở run gốc 4f161c8c case này được trả lời mù theo 30s lỗi thời. Item vẫn bị fail `caveat_missing` **chỉ vì từ vựng label** (`which/workload/could you/clarify` vs cách diễn đạt "global/role-specific/30s/300s" của model) — cùng pattern label đã khắc phục ở clarification-v2; robustness-v1 là held-out nên giữ nguyên, chỉ ghi nhận.
- **`behaviorDecisions` trên eligible: clarify precision 1.0 · recall 1.0 (1/1 case clarify hợp lệ) · correct behavior 0.818 · unnecessary clarifications 0** — không có clarify oan trên held-out.
- rb-under-001/003 rơi vào nhóm pipeline error (bị loại, không kết luận gì).

Kết luận hold-out một phần: **fix không gây regression và chuyển đúng case khó nhất sang clarify**; số liệu đầy đủ chờ run không bị quota cắt (quota TPD hồi mới chạy lại được — không ưu tiên vì đã có clarification-v2 làm thước đo chính).

### 4.3. Đơn test đã khóa hành vi (không phụ thuộc quota)

`npm test` **99/99** (từ 71), trong đó 28 test mới khóa: parser behavior (8 — fallback graceful, dấu ? trong code fence không tính), unnecessary_clarification (3), clarify phải hỏi thật + nêu đúng chi tiết thiếu (2), math của `behaviorDecisions` gồm loại pipeline-error + eligible denominators (3), schema clarification-v1/v2 + immutability (11), runner truyền history (2).

## 5. Hạn chế & rủi ro còn lại

- Clarify/keyword/caveat matching là **heuristic lexical** (như toàn bộ module eval): câu hỏi làm rõ dùng từ đồng nghĩa với label có thể bị fail oan; ngược lại một câu hỏi trùng keyword nhưng vô dụng vẫn qua. Đọc câu trả lời lưu trữ trước khi kết luận.
- Quyết định clarify phụ thuộc prompt + reasoning effort (model gpt-oss-120b, hiện `reasoning_effort=medium`, temperature 0.6). Nó là quyết định xác suất, không phải logic cứng — run-to-run variance tồn tại. Medium reasoning tăng completion tokens (~+0.5–1.5k/call) — cần chú ý ngân sách TPD.
- `falseAnswersOnClarify` chỉ đếm model **tuyên bố** `answer`; một `partial_answer` (đã thừa nhận thiếu hụt + hỏi follow-up) trên item clarify không bị tính là false answer — đúng thiết kế nhưng cần lưu ý khi đọc số.
- **Hạ tầng quota Groq free tier**: ngoài RPM/TPM đã biết, `gpt-oss-120b` còn giới hạn **TPD 200k tokens/ngày** (rolling window). Một ngày eval dồn tụ (robustness 29 items + v1 23 items + clarification 14 items ≈ 75k–100k tokens) có thể cạn bucket khiến các run sau bị 429-storm. `ITEM_DELAY_MS` đã nâng 3s → 30s; khi bucket cạn, trì hoãn run thay vì thử lại liên tục (mỗi 429 kéo theo retry-after 90s).
