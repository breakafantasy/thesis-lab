// 步骤一/二：命题解析 + 澄清 + 修订（AI 角色：命题分析师）

import { chatJSON, isObj, isStrArray } from "../llm";
import { PROMPT_PARSE_AND_CLARIFY, PROMPT_REVISE } from "../prompts";
import type { ClarificationQuestion, Thesis } from "../types";

export interface ParseResult {
  isAdvisory: boolean;
  advisoryGuidance?: string;
  rewrittenThesis?: string;
  elements: Thesis["elements"];
  ambiguities: ClarificationQuestion[];
}

const DIMENSIONS = ["标的", "时间窗口", "指标口径", "对比基准", "断言方向", "其他"];

function validateParse(v: unknown): string | null {
  if (!isObj(v)) return "顶层必须是 JSON 对象";
  if (typeof v.isAdvisory !== "boolean") return "缺少 isAdvisory（布尔）字段";
  if (v.isAdvisory) {
    if (typeof v.advisoryGuidance !== "string" || typeof v.rewrittenThesis !== "string")
      return "荐股模式缺少 advisoryGuidance / rewrittenThesis 文本字段";
    return null;
  }
  if (!isObj(v.elements)) return "缺少 elements 对象";
  if (!Array.isArray(v.ambiguities)) return "缺少 ambiguities 数组";
  if (v.ambiguities.length > 4) return "ambiguities 最多 4 个";
  for (const a of v.ambiguities) {
    if (!isObj(a)) return "ambiguities 元素必须是对象";
    if (typeof a.id !== "string" || typeof a.question !== "string") return "ambiguities 缺少 id/question 字符串";
    if (!isStrArray(a.options) || a.options.length < 2) return `ambiguities ${a.id} 的 options 需至少 2 个字符串`;
    if (typeof a.defaultOption !== "string") return `ambiguities ${a.id} 缺少 defaultOption`;
    if (!a.options.includes(a.defaultOption)) return `ambiguities ${a.id} 的 defaultOption 必须在 options 中`;
    if (typeof a.why !== "string") return `ambiguities ${a.id} 缺少 why`;
    if (!DIMENSIONS.includes(a.dimension as string)) return `ambiguities ${a.id} 的 dimension 非法`;
  }
  return null;
}

export async function parseAndClarify(rawText: string): Promise<ParseResult> {
  const v = await chatJSON<Record<string, unknown>>({
    system: PROMPT_PARSE_AND_CLARIFY,
    user: `用户输入：\n${rawText}`,
    validate: validateParse,
  });
  return {
    isAdvisory: v.isAdvisory === true,
    advisoryGuidance: typeof v.advisoryGuidance === "string" ? v.advisoryGuidance : undefined,
    rewrittenThesis: typeof v.rewrittenThesis === "string" ? v.rewrittenThesis : undefined,
    elements: (v.elements as Thesis["elements"]) ?? {},
    ambiguities: (v.ambiguities as ClarificationQuestion[]) ?? [],
  };
}

export interface ClarificationAnswer {
  questionId: string;
  question: string;
  answer: string;
}

function validateRevise(v: unknown): string | null {
  if (!isObj(v)) return "顶层必须是 JSON 对象";
  if (typeof v.revisedText !== "string" || !v.revisedText.trim()) return "缺少 revisedText 字符串";
  if (!Array.isArray(v.revisionNotes)) return "缺少 revisionNotes 数组";
  for (const n of v.revisionNotes) {
    if (!isObj(n) || typeof n.from !== "string" || typeof n.to !== "string" || typeof n.reason !== "string")
      return "revisionNotes 元素需包含 from/to/reason 字符串";
  }
  return null;
}

export async function reviseThesis(
  rawText: string,
  elements: Thesis["elements"],
  questions: ClarificationQuestion[],
  answers: ClarificationAnswer[]
): Promise<Thesis> {
  const answered = answers.filter((a) => questions.some((q) => q.id === a.questionId));
  const v = await chatJSON<Record<string, unknown>>({
    system: PROMPT_REVISE,
    user: JSON.stringify(
      { rawText, elements, clarifications: answered.map((a) => ({ question: a.question, answer: a.answer })) },
      null,
      2
    ),
    validate: validateRevise,
  });
  return {
    id: `TH-${crypto.randomUUID().slice(0, 8)}`,
    rawText,
    revisedText: v.revisedText as string,
    clarifications: answered,
    elements,
    revisionNotes: v.revisionNotes as Thesis["revisionNotes"],
  };
}
