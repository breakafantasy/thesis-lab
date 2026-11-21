// 步骤六：结论 + 置信度 + 结论反转条件（AI 角色：结论撰写者）
// 确定性兜底规则：证据缺失/降级占比 ≥ 1/3 时强制「无法判断」，置信度上限 0.6。

import { chatJSON, isObj } from "../llm";
import { PROMPT_CONCLUDE } from "../prompts";
import { collectKnownNumbers, sanitizeNumbers } from "./decompose";
import type { ConflictPair, DataPayload, Evidence, ReversalCondition, Thesis, Verdict, VerdictLevel } from "../types";

const LEVELS: VerdictLevel[] = ["support", "partial_support", "unsupported", "undetermined"];

function validateConclude(v: unknown): string | null {
  if (!isObj(v)) return "顶层必须是 JSON 对象";
  if (!LEVELS.includes(v.level as VerdictLevel)) return "level 非法";
  if (typeof v.statement !== "string" || !v.statement.trim()) return "缺少 statement";
  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) return "confidence 需为 0-1 数字";
  if (!Array.isArray(v.evidenceIndex)) return "缺少 evidenceIndex 数组";
  for (const item of v.evidenceIndex as unknown[]) {
    if (!isObj(item) || typeof item.evidenceId !== "string") return "evidenceIndex 元素缺少 evidenceId";
  }
  if (!Array.isArray(v.reversalConditions) || v.reversalConditions.length < 2 || v.reversalConditions.length > 4)
    return "reversalConditions 需 2-4 条";
  for (const rc of v.reversalConditions as unknown[]) {
    if (!isObj(rc)) return "reversalConditions 元素必须是对象";
    const r = rc as Record<string, unknown>;
    if (typeof r.description !== "string" || typeof r.trigger !== "string" || typeof r.effect !== "string")
      return "reversalConditions 缺少 description/trigger/effect";
    if (!isObj(r.monitor) || typeof r.monitor.source !== "string" || typeof r.monitor.kind !== "string" || !isObj(r.monitor.params))
      return "reversalConditions 的 monitor 需含 source/kind/params";
  }
  return null;
}

export async function conclude(
  thesis: Thesis,
  evidences: Evidence[],
  conflicts: ConflictPair[],
  payloads: DataPayload[]
): Promise<Verdict> {
  const knownNumbers = collectKnownNumbers(payloads);
  const v = await chatJSON<Record<string, unknown>>({
    system: PROMPT_CONCLUDE,
    user: JSON.stringify(
      {
        修订后命题: thesis.revisedText,
        证据: evidences.map((e) => ({
          id: e.id,
          subQuestionId: e.subQuestionId,
          stance: e.stance,
          claim: e.claim,
          reasoning: e.reasoning,
          confidence: e.confidence,
          status: e.status,
        })),
        冲突仲裁: conflicts,
        载荷要点: payloads.map((p) => ({ id: p.id, source: p.source, status: p.status, points: p.points })),
      },
      null,
      2
    ),
    validate: validateConclude,
  });

  // 防伪造：statement 中的数值必须来自载荷
  const statement = sanitizeNumbers(v.statement as string, knownNumbers).text;

  // 确定性兜底：证据或载荷缺失/异常占比 ≥ 1/3 → 无法判断
  // 说明：降级到内置快照（status=degraded）属于「数据仍可用但来源降级」，不触发强制无法判断，
  // 但会在证据载荷中如实标注；status=error/empty 才视为证据缺失。
  const weakEvidences = evidences.filter((e) => e.status !== "ok").length;
  const weakPayloads = payloads.filter((p) => p.status === "error" || p.status === "empty").length;
  const weak = weakEvidences + weakPayloads;
  let level = v.level as VerdictLevel;
  let confidence = v.confidence as number;
  if (evidences.length > 0 && weak / evidences.length >= 1 / 3) {
    level = "undetermined";
    confidence = Math.min(confidence, 0.6);
  }

  const validIds = new Set(evidences.map((e) => e.id));
  const evidenceIndex = (v.evidenceIndex as { evidenceId: string; stance: string }[]).filter((x) =>
    validIds.has(x.evidenceId)
  );
  if (evidenceIndex.length === 0) {
    for (const e of evidences) evidenceIndex.push({ evidenceId: e.id, stance: e.stance });
  }

  const reversalConditions = (v.reversalConditions as unknown[]).map((raw, i) => {
    const r = raw as Record<string, unknown>;
    const mon = r.monitor as Record<string, unknown>;
    return {
      id: `RC-${i + 1}-${crypto.randomUUID().slice(0, 6)}`,
      description: r.description as string,
      trigger: sanitizeNumbers(r.trigger as string, knownNumbers).text,
      effect: sanitizeNumbers(r.effect as string, knownNumbers).text,
      monitor: {
        source: mon.source as ReversalCondition["monitor"]["source"],
        kind: mon.kind as string,
        params: mon.params as Record<string, string>,
      },
    };
  });

  return { level, statement, confidence, evidenceIndex, conflicts, reversalConditions };
}
