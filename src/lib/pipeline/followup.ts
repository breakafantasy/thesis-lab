// 追问：基于已完成验证任务的多轮提问（只依据任务证据链回答）

import { chatJSON, isObj } from "../llm";
import { PROMPT_FOLLOWUP } from "../prompts";
import { collectKnownNumbers, sanitizeNumbers } from "./decompose";
import type { VerificationTask } from "../types";

function validateFollowup(v: unknown): string | null {
  if (!isObj(v)) return "顶层必须是 JSON 对象";
  if (typeof v.answer !== "string" || !v.answer.trim()) return "缺少 answer 字符串";
  if (!Array.isArray(v.referencedEvidenceIds)) return "缺少 referencedEvidenceIds 数组";
  return null;
}

export async function answerFollowup(
  task: VerificationTask,
  question: string
): Promise<{ answer: string; referencedEvidenceIds: string[] }> {
  const v = await chatJSON<Record<string, unknown>>({
    system: PROMPT_FOLLOWUP,
    user: JSON.stringify(
      {
        命题: task.thesis.revisedText,
        结论: { level: task.verdict.level, statement: task.verdict.statement },
        证据链: task.evidences.map((e) => ({ id: e.id, stance: e.stance, claim: e.claim })),
        载荷要点: task.payloads.map((p) => ({ id: p.id, points: p.points })),
        用户追问: question,
      },
      null,
      2
    ),
    validate: validateFollowup,
  });
  const knownNumbers = collectKnownNumbers(task.payloads);
  const validIds = new Set(task.evidences.map((e) => e.id));
  return {
    answer: sanitizeNumbers(v.answer as string, knownNumbers).text,
    referencedEvidenceIds: (v.referencedEvidenceIds as string[]).filter((id) => validIds.has(id)),
  };
}
