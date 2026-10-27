// Verify clarification-v2 is structurally identical to v1 except widened caveat labels.
const a = require("../../eval/datasets/clarification-v1.json");
const b = require("../../eval/datasets/clarification-v2.json");
const same = a.items.every(
  (x, i) =>
    x.id === b.items[i].id &&
    x.question === b.items[i].question &&
    x.expectedBehavior === b.items[i].expectedBehavior &&
    JSON.stringify(x.history) === JSON.stringify(b.items[i].history) &&
    JSON.stringify(x.expectedFileNames) === JSON.stringify(b.items[i].expectedFileNames) &&
    JSON.stringify(x.expectedKeywords) === JSON.stringify(b.items[i].expectedKeywords),
);
console.log("structural identity:", same, "| v2 items:", b.items.length);
for (const it of b.items) {
  const old = a.items.find((x) => x.id === it.id);
  if (JSON.stringify(old.caveatKeywords) !== JSON.stringify(it.caveatKeywords)) {
    console.log(`widened ${it.id}: [${old.caveatKeywords}] -> [${it.caveatKeywords}]`);
  }
}
