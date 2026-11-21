// 步骤三：拆解为可验证子问题（AI 角色：命题分析师）

import { chatJSON, isObj, isStrArray } from "../llm";
import { PROMPT_DECOMPOSE } from "../prompts";
import type { DataNeed, SubQuestion, Thesis } from "../types";

const SOURCES = ["fuyao", "ifind"];

function validateDecompose(v: unknown): string | null {
  if (!isObj(v) || !Array.isArray(v.subQuestions)) return "缺少 subQuestions 数组";
  const list = v.subQuestions as unknown[];
  if (list.length < 3 || list.length > 6) return `subQuestions 需 3-6 个（当前 ${list.length}）`;
  for (const item of list) {
    if (!isObj(item)) return "subQuestions 元素必须是对象";
    const sq = item as Record<string, unknown>;
    if (typeof sq.id !== "string" || typeof sq.text !== "string" || !sq.text.trim()) return "子问题缺少 id/text";
    if (typeof sq.verifiable !== "boolean") return `子问题 ${sq.id} 缺少 verifiable 布尔`;
    if (typeof sq.metricSpec !== "string" || !sq.metricSpec.trim()) return `子问题 ${sq.id} 缺少 metricSpec`;
    if (!Array.isArray(sq.dataNeeds)) return `子问题 ${sq.id} 缺少 dataNeeds 数组`;
    if (sq.verifiable === false && (sq.dataNeeds as unknown[]).length > 0)
      return `子问题 ${sq.id} 标记不可验证时 dataNeeds 必须为空`;
    for (const need of sq.dataNeeds as unknown[]) {
      if (!isObj(need)) return `子问题 ${sq.id} 的 dataNeeds 元素必须是对象`;
      const n = need as Record<string, unknown>;
      if (!SOURCES.includes(n.source as string)) return `子问题 ${sq.id} 的 dataNeed.source 必须是 fuyao/ifind`;
      if (typeof n.kind !== "string" || !n.kind.trim()) return `子问题 ${sq.id} 的 dataNeed 缺少 kind`;
      if (!isObj(n.params)) return `子问题 ${sq.id} 的 dataNeed.params 必须是对象`;
      if (typeof n.queryDescription !== "string" || !n.queryDescription.trim())
        return `子问题 ${sq.id} 的 dataNeed 缺少 queryDescription`;
    }
  }
  return null;
}

export async function decomposeThesis(thesis: Thesis): Promise<SubQuestion[]> {
  const v = await chatJSON<Record<string, unknown>>({
    system: PROMPT_DECOMPOSE,
    user: `修订后命题：\n${thesis.revisedText}\n\n命题要素：\n${JSON.stringify(thesis.elements, null, 2)}`,
    validate: validateDecompose,
  });
  const items = (v.subQuestions as unknown[]).map((item, i) => {
    const sq = item as Record<string, unknown>;
    return {
      id: `SQ-${i + 1}-${crypto.randomUUID().slice(0, 6)}`,
      text: sq.text as string,
      verifiable: sq.verifiable === true,
      metricSpec: sq.metricSpec as string,
      dataNeeds: (sq.dataNeeds as DataNeed[]) ?? [],
    };
  });
  return items;
}

/** 防伪造扫描辅助：检查文本中的数字是否全部来自载荷 */
export function numbersIn(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?%?/g) ?? [];
}

export function findForeignNumbers(text: string, knownNumbers: Set<string>): string[] {
  return numbersIn(text).filter((n) => {
    const core = n.replace(/%$/, "");
    return !knownNumbers.has(core) && !knownNumbers.has(n);
  });
}

/** 把载荷中没有的数字替换为「见载荷」（防伪造兜底，优先于 LLM 重试） */
export function sanitizeNumbers(text: string, knownNumbers: Set<string>): { text: string; stripped: string[] } {
  const stripped: string[] = [];
  let out = text;
  for (const n of numbersIn(text)) {
    const core = n.replace(/%$/, "");
    if (!knownNumbers.has(core) && !knownNumbers.has(n)) {
      out = out.replaceAll(n, "见载荷");
      if (!stripped.includes(n)) stripped.push(n);
    }
  }
  return { text: out, stripped };
}

export function collectKnownNumbers(payloads: import("../types").DataPayload[]): Set<string> {
  const known = new Set<string>();
  for (const p of payloads) {
    for (const pt of p.points) {
      for (const n of String(pt.value).match(/\d+(?:\.\d+)?/g) ?? []) known.add(n);
      for (const n of (pt.period ?? "").match(/\d+/g) ?? []) known.add(n);
      if (pt.unit) for (const n of pt.unit.match(/\d+(?:\.\d+)?/g) ?? []) known.add(n);
    }
    for (const m of p.materials) {
      for (const n of (m.date ?? "").match(/\d+/g) ?? []) known.add(n);
    }
  }
  return known;
}
