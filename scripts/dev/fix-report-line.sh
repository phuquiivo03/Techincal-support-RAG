#!/bin/bash
# One-off: replace line 62 of the robustness report (unicode exact-match issue with the editor).
FILE=/home/quivo/porfolio/RAGTechSupport/docs/ROBUSTNESS_EVALUATION.md
awk 'NR==62 { print "| Keyword coverage | tỉ lệ `expectedKeywords` xuất hiện trong câu trả lời (khớp từ vựng, không phải ngữ nghĩa) | **sàn từ vựng**: câu sai mà chứa từ khóa vẫn pass (FP-1, đã khóa trong `metrics.limitations.test.ts`); câu đúng diễn đạt khác từ khóa thì fail |"; next } { print }' "$FILE" > "$FILE.tmp" && mv "$FILE.tmp" "$FILE"
sed -n '62p' "$FILE"
