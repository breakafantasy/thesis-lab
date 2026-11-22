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

/** 冲突配对时的停用词（2 字片段），避免「数据/载荷」等通用词造成误配对 */
const STOP_BIGRAMS = new Set([
  "载荷", "数据", "证据", "支持", "反对", "无法", "验证", "归类", "断言",
  "问题", "命题", "该子", "见载", "显示", "提供", "说明", "状态", "来源",
  "理由", "降级", "为空", "返回", "查询",
]);

/** 提取证据文本中的中文 2 字片段（跳过停用词），用于跨子问题冲突配对 */
function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.match(/[一-龥]+/g) ?? []) {
    for (let i = 0; i + 2 <= m.length; i++) {
      const seg = m.slice(i, i + 2);
      if (!STOP_BIGRAMS.has(seg)) out.add(seg);
    }
  }
  return out;
}

function overlapScore(a: Evidence, b: Evidence): number {
  const ta = terms(`${a.claim} ${a.reasoning}`);
  const tb = terms(`${b.claim} ${b.reasoning}`);
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n;
}

/**
 * 冲突对检测：
 * 1) 同一子问题下 support/partial 与 oppose 并存；
 * 2) 跨子问题：反对证据与支持证据讨论同一组财务概念（关键词重叠 ≥2）时也视为
 *    命题要件之间的冲突——例如「归母改善（支持）」与「扣非为负（反对）」。
 * 上限 4 对，按相关性排序。
 */
export function detectConflicts(evidences: Evidence[]): { a: Evidence; b: Evidence }[] {
  const pairs: { a: Evidence; b: Evidence; score: number }[] = [];
  const bySq = new Map<string, Evidence[]>();
  for (const e of evidences) {
    const list = bySq.get(e.subQuestionId) ?? [];
    list.push(e);
    bySq.set(e.subQuestionId, list);
  }
  // 同子问题内
  for (const list of bySq.values()) {
    const pro = list.filter((e) => e.stance === "support" || e.stance === "partial");
    const con = list.filter((e) => e.stance === "oppose");
    for (const a of pro) for (const b of con) pairs.push({ a, b, score: 2 });
  }
  // 跨子问题：每条反对证据配对一条最相关的支持证据
  const pros = evidences.filter((e) => e.stance === "support" || e.stance === "partial");
  const cons = evidences.filter((e) => e.stance === "oppose");
  for (const b of cons) {
    let best: { a: Evidence; score: number } | null = null;
    for (const a of pros) {
      if (a.subQuestionId === b.subQuestionId) continue; // 同子问题已在上面处理
      const s = overlapScore(a, b);
      if (s >= 2 && (!best || s > best.score)) best = { a, score: s };
    }
    if (best) pairs.push({ a: best.a, b, score: best.score });
  }
  // 去重 + 按相关性排序 + 上限 4
  const seen = new Set<string>();
  const out: { a: Evidence; b: Evidence }[] = [];
  for (const p of pairs.sort((x, y) => y.score - x.score)) {
    const key = [p.a.id, p.b.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ a: p.a, b: p.b });
    if (out.length >= 4) break;
  }
  return out;
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
