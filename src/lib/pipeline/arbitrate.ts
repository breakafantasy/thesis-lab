// 步骤五：证据冲突检测与仲裁（AI 角色：冲突仲裁者）

import { chatJSON, isObj } from "../llm";
import { PROMPT_ARBITRATE } from "../prompts";
import { sanitizeNumbers, collectKnownNumbers } from "./decompose";
import type { ConflictPair, DataPayload, Evidence } from "../types";

const DIMENSIONS = ["口径差异", "时间窗口", "来源权威性", "样本量", "其他"];

function validateArbitrate(v: unknown): string | null {
  if (!isObj(v) || !Array.isArray(v.conflicts)) return "缺少 conflicts 数组";
  for (const c of v.conflicts as unknown[]) {
    if (!isObj(c)) return "conflicts 元素必须是对象";
    const item = c as Record<string, unknown>;
    if (typeof item.evidenceA !== "string" || typeof item.evidenceB !== "string")
      return "conflicts 缺少 evidenceA/evidenceB";
    if (!DIMENSIONS.includes(item.dimension as string)) return `conflicts dimension 非法：${item.dimension}`;
    if (typeof item.resolution !== "string" || !item.resolution.trim()) return "conflicts 缺少 resolution";
    if (typeof item.ruleApplied !== "string" || !item.ruleApplied.trim()) return "conflicts 缺少 ruleApplied";
  }
  return null;
}

/** 冲突对检测：同一子问题下 support/partial 与 oppose 同时存在即视为冲突 */
export function detectConflicts(evidences: Evidence[]): { a: Evidence; b: Evidence }[] {
  const pairs: { a: Evidence; b: Evidence }[] = [];
  const bySq = new Map<string, Evidence[]>();
  for (const e of evidences) {
    const list = bySq.get(e.subQuestionId) ?? [];
    list.push(e);
    bySq.set(e.subQuestionId, list);
  }
  for (const list of bySq.values()) {
    const pro = list.filter((e) => e.stance === "support" || e.stance === "partial");
    const con = list.filter((e) => e.stance === "oppose");
    for (const a of pro) for (const b of con) pairs.push({ a, b });
  }
  return pairs;
}

export async function arbitrateConflicts(evidences: Evidence[], payloads: DataPayload[]): Promise<ConflictPair[]> {
  const pairs = detectConflicts(evidences);
  if (pairs.length === 0) return [];
  const knownNumbers = collectKnownNumbers(payloads);
  const v = await chatJSON<Record<string, unknown>>({
    system: PROMPT_ARBITRATE,
    user: JSON.stringify(
      {
        冲突对: pairs.map(({ a, b }) => ({
          evidenceA: a.id,
          evidenceB: b.id,
          A: { claim: a.claim, reasoning: a.reasoning, stance: a.stance },
          B: { claim: b.claim, reasoning: b.reasoning, stance: b.stance },
        })),
        载荷要点: payloads.map((p) => ({ id: p.id, source: p.source, points: p.points })),
      },
      null,
      2
    ),
    validate: validateArbitrate,
  });
  const validIds = new Set(evidences.map((e) => e.id));
  const conflicts = (v.conflicts as unknown[])
    .filter((c) => {
      const item = c as Record<string, unknown>;
      return validIds.has(item.evidenceA as string) && validIds.has(item.evidenceB as string);
    })
    .map((c, i) => {
      const item = c as Record<string, unknown>;
      const san = sanitizeNumbers(`${item.resolution}`, knownNumbers);
      return {
        id: `CF-${i + 1}-${crypto.randomUUID().slice(0, 6)}`,
        evidenceA: item.evidenceA as string,
        evidenceB: item.evidenceB as string,
        dimension: item.dimension as ConflictPair["dimension"],
        resolution: san.text,
        ruleApplied: item.ruleApplied as string,
      };
    });
  return conflicts;
}
