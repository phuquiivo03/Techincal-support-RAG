// List recent runs per suite with labels — quota-cheap status check for the cron.
const suites = ["clarification", "robustness", "baseline"];
for (const s of suites) {
  const res = await fetch(`http://127.0.0.1:4000/api/eval/runs?suite=${s}`);
  const { runs } = await res.json();
  console.log(`== ${s} (${runs.length} runs)`);
  for (const r of runs.slice(0, 6)) {
    console.log(`   ${r.datasetVersion} | ${r.label ?? "-"} | ${new Date(r.createdAt).toISOString()} | ${r.metrics.passed}/${r.metrics.items}`);
  }
}
