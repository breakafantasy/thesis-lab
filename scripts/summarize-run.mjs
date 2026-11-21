// 临时脚本：解析 SSE 结果文件并输出主链路摘要（Node 原生 UTF-8/JSON）
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "docs/tmp-verify2-result.txt";
const raw = readFileSync(file, "utf-8");
const events = [];
for (const chunk of raw.split("\n\n")) {
  const line = chunk.trim();
  if (line.startsWith("data: ")) {
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch {}
  }
}

const byType = (t) => events.filter((e) => e.type === t);
console.log("== 事件类型 ==");
for (const g of Object.entries(
  events.reduce((acc, e) => ((acc[e.type] = (acc[e.type] ?? 0) + 1), acc), {})
)) console.log(`  ${g[0]} x${g[1]}`);

console.log("\n== 阶段 ==");
for (const e of byType("stage")) console.log(`  ${e.stage}: ${e.message}`);

console.log("\n== 修订后命题 ==");
const thesis = byType("thesis")[0]?.thesis;
console.log(`  ${thesis?.revisedText}`);
console.log("  修订记录:", JSON.stringify(thesis?.revisionNotes ?? [], null, 2));

console.log("\n== 子问题 ==");
byType("subquestions")[0]?.items.forEach((sq, i) => {
  console.log(`  ${i + 1}. ${sq.text} [可验证:${sq.verifiable}] 口径:${sq.metricSpec}`);
  console.log(`     数据需求: ${sq.dataNeeds.map((n) => `${n.source}/${n.kind}(${JSON.stringify(n.params)})`).join("  ")}`);
});

console.log("\n== 数据载荷 ==");
for (const e of byType("payload")) {
  const p = e.payload;
  console.log(`  ${p.id} 实际=${p.source} 请求=${p.requestedSource} 状态=${p.status} 数据点=${p.points.length} 材料=${p.materials.length}`);
  if (p.statusNote) console.log(`    备注: ${p.statusNote}`);
  if (p.points.length > 0 && p.points.length <= 10) {
    for (const pt of p.points) console.log(`    · ${pt.label} ${pt.period ?? ""} = ${pt.value}${pt.unit ? " " + pt.unit : ""}`);
  }
}

const task = byType("done")[0]?.task;
console.log("\n== 证据链 ==");
for (const e of task?.evidences ?? []) {
  console.log(`  [${e.stance}] ${e.id} 状态=${e.status} 载荷=${e.payloadIds.join(",")}`);
  console.log(`    ${e.claim}`);
  console.log(`    理由: ${e.reasoning}`);
}

console.log("\n== 冲突 ==");
for (const c of task?.verdict?.conflicts ?? []) {
  console.log(`  ${c.dimension}: ${c.evidenceA} <-> ${c.evidenceB}`);
  console.log(`    仲裁: ${c.resolution}`);
  console.log(`    规则: ${c.ruleApplied}`);
}

console.log("\n== 结论 ==");
console.log(`  等级: ${task?.verdict?.level}  置信度: ${task?.verdict?.confidence}`);
console.log(`  ${task?.verdict?.statement}`);
console.log("  证据索引:", (task?.verdict?.evidenceIndex ?? []).map((x) => x.evidenceId).join(", "));

console.log("\n== 反转条件 ==");
for (const rc of task?.verdict?.reversalConditions ?? []) {
  console.log(`  - ${rc.description}`);
  console.log(`    触发: ${rc.trigger}`);
  console.log(`    结论变化: ${rc.effect}`);
  console.log(`    监测: ${rc.monitor.source}/${rc.monitor.kind} ${JSON.stringify(rc.monitor.params)}`);
}
