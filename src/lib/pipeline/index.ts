// 管线编排：解析 → 澄清/修订 → 拆解 → 证据 → 仲裁 → 结论 → 研究任务
// 澄清阶段会中断等待用户回答（返回 null），客户端携带澄清答案后重新调用。

import type { PipelineEvent, VerificationTask } from "../types";
import { parseAndClarify } from "./clarify";
import { reviseThesis, type ClarificationAnswer } from "./clarify";
import { decomposeThesis } from "./decompose";
import { gatherEvidence } from "./evidence";
import { arbitrateConflicts } from "./arbitrate";
import { conclude } from "./conclude";

export interface RunOptions {
  thesisText: string;
  clarifications?: ClarificationAnswer[];
  faultDemo?: boolean;
}

export type RunResult = { kind: "task"; task: VerificationTask } | { kind: "interrupted" };

export async function runVerification(
  opts: RunOptions,
  emit: (e: PipelineEvent) => void
): Promise<RunResult> {
  const fail = (stage: string, err: unknown): never => {
    emit({ type: "error", stage, message: err instanceof Error ? err.message : String(err) });
    throw err instanceof Error ? err : new Error(String(err));
  };

  // ① 解析 + 荐股式输入拦截
  emit({ type: "stage", stage: "parse", message: "解析命题，识别关键歧义…" });
  let parsed;
  try {
    parsed = await parseAndClarify(opts.thesisText);
  } catch (e) {
    return fail("parse", e);
  }
  if (parsed.isAdvisory) {
    emit({
      type: "advisory",
      guidance: parsed.advisoryGuidance ?? "请将问题改写为可验证的投资命题。",
      rewrittenThesis: parsed.rewrittenThesis ?? "",
    });
    return { kind: "interrupted" };
  }

  // ② 澄清（无答案且有歧义 → 中断等待用户）
  const questions = parsed.ambiguities;
  const answers = opts.clarifications ?? [];
  if (questions.length > 0 && answers.length === 0) {
    emit({ type: "clarify", questions, elements: parsed.elements });
    return { kind: "interrupted" };
  }

  // ③ 修订命题
  emit({ type: "stage", stage: "revise", message: "结合澄清回答修订命题…" });
  let thesis;
  try {
    thesis = await reviseThesis(opts.thesisText, parsed.elements, questions, answers);
  } catch (e) {
    return fail("revise", e);
  }
  emit({ type: "thesis", thesis });

  // ④ 拆解子问题
  emit({ type: "stage", stage: "decompose", message: "拆解为可验证子问题，设计数据查询计划…" });
  let subQuestions;
  try {
    subQuestions = await decomposeThesis(thesis);
  } catch (e) {
    return fail("decompose", e);
  }
  emit({ type: "subquestions", items: subQuestions });

  // ⑤ 证据链
  emit({ type: "stage", stage: "evidence", message: "调用数据源（扶摇 / iFinD MCP），构建证据链…" });
  let gathered;
  try {
    gathered = await gatherEvidence(subQuestions, { faultDemo: opts.faultDemo }, emit);
  } catch (e) {
    return fail("evidence", e);
  }
  const { payloads, evidences } = gathered;

  // ⑥ 冲突仲裁
  emit({ type: "stage", stage: "arbitrate", message: "检测并仲裁证据冲突…" });
  let conflicts;
  try {
    conflicts = await arbitrateConflicts(evidences, payloads);
  } catch (e) {
    return fail("arbitrate", e);
  }
  emit({ type: "conflicts", conflicts });

  // ⑦ 结论与反转条件
  emit({ type: "stage", stage: "conclude", message: "形成可追溯结论与结论反转条件…" });
  let verdict;
  try {
    verdict = await conclude(thesis, evidences, conflicts, payloads);
  } catch (e) {
    return fail("conclude", e);
  }
  emit({ type: "verdict", verdict });

  const task: VerificationTask = {
    id: `T-${crypto.randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    thesis,
    subQuestions,
    payloads,
    evidences,
    verdict,
    followups: [],
  };
  emit({ type: "done", task });
  return { kind: "task", task };
}
