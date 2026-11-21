// 步骤四：数据采集 + 证据链构建（AI 角色：证据组织者）
// 数值只来自数据载荷；LLM 输出经 sanitizeNumbers 兜底，载荷外数字一律替换为「见载荷」。

import { chatJSON, isObj } from "../llm";
import { PROMPT_EVIDENCE } from "../prompts";
import { fetchData, type FetchOptions } from "../data/registry";
import { collectKnownNumbers, sanitizeNumbers } from "./decompose";
import type { DataPayload, Evidence, EvidenceStance, PipelineEvent, SubQuestion } from "../types";

const STANCES: EvidenceStance[] = ["support", "oppose", "unverifiable", "partial"];
const STATUSES = ["ok", "degraded", "empty"];

function validateEvidence(v: unknown): string | null {
  if (!isObj(v) || !Array.isArray(v.items)) return "缺少 items 数组";
  for (const item of v.items as unknown[]) {
    if (!isObj(item)) return "items 元素必须是对象";
    const e = item as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.subQuestionId !== "string") return "证据缺少 id/subQuestionId";
    if (!STANCES.includes(e.stance as EvidenceStance)) return `证据 ${e.id} 的 stance 非法`;
    if (typeof e.claim !== "string" || !e.claim.trim()) return `证据 ${e.id} 缺少 claim`;
    if (typeof e.reasoning !== "string" || !e.reasoning.trim()) return `证据 ${e.id} 缺少 reasoning`;
    if (!Array.isArray(e.payloadIds)) return `证据 ${e.id} 缺少 payloadIds 数组`;
    if (typeof e.confidence !== "number" || e.confidence < 0 || e.confidence > 1)
      return `证据 ${e.id} 的 confidence 需为 0-1 数字`;
    if (!STATUSES.includes(e.status as string)) return `证据 ${e.id} 的 status 非法`;
  }
  return null;
}

/** 确定性生成的「无法验证」证据（数据需求为空或全部异常时，不消耗 LLM） */
export function localUnverifiable(sq: SubQuestion, reason: string): Evidence {
  return {
    id: `EV-${sq.id}-NV`,
    subQuestionId: sq.id,
    stance: "unverifiable",
    claim: reason,
    reasoning: sq.verifiable
      ? "该子问题的数据需求未返回可用数据（数据源未配置/异常/无数据），按产品规则标记为无法验证，不做猜测。"
      : "该子问题在拆解时即判定无法用现有数据源验证（扶摇/iFinD 不覆盖所需信息），按产品规则标记为无法验证。",
    payloadIds: [],
    confidence: 0,
    status: "empty",
  };
}

export interface GatherResult {
  payloads: DataPayload[];
  evidences: Evidence[];
}

export async function gatherEvidence(
  subQuestions: SubQuestion[],
  opts: FetchOptions,
  emit?: (e: PipelineEvent) => void
): Promise<GatherResult> {
  // 1) 执行全部数据需求（按子问题顺序推送载荷事件）
  const payloads: DataPayload[] = [];
  for (const sq of subQuestions) {
    if (!sq.verifiable || sq.dataNeeds.length === 0) continue;
    const results = await Promise.all(sq.dataNeeds.map((n) => fetchData(n, sq.id, opts)));
    for (const p of results) {
      payloads.push(p);
      emit?.({ type: "payload", payload: p });
    }
  }

  // 2) 逐个子问题组织证据
  const knownNumbers = collectKnownNumbers(payloads);
  const evidences: Evidence[] = [];
  for (const sq of subQuestions) {
    const sqPayloads = payloads.filter((p) => p.subQuestionId === sq.id);
    if (sqPayloads.length === 0) {
      evidences.push(
        localUnverifiable(
          sq,
          sq.verifiable ? "数据源未返回可用数据，该子问题无法验证" : "该子问题无法用现有数据源验证"
        )
      );
      continue;
    }
    const v = await chatJSON<Record<string, unknown>>({
      system: PROMPT_EVIDENCE,
      user: JSON.stringify(
        {
          子问题: { id: sq.id, text: sq.text, metricSpec: sq.metricSpec },
          数据载荷: sqPayloads.map((p) => ({
            id: p.id,
            source: p.source,
            status: p.status,
            statusNote: p.statusNote,
            points: p.points,
            materials: p.materials.map((m) => ({ title: m.title, source: m.source, date: m.date, quote: m.quote })),
          })),
        },
        null,
        2
      ),
      validate: validateEvidence,
    });
    const items = (v.items as unknown[]).map((raw) => {
      const e = raw as Record<string, unknown>;
      const claim = e.claim as string;
      const reasoning = e.reasoning as string;
      const sanClaim = sanitizeNumbers(claim, knownNumbers);
      const sanReason = sanitizeNumbers(reasoning, knownNumbers);
      if (sanClaim.stripped.length > 0 || sanReason.stripped.length > 0) {
        return {
          id: `EV-${sq.id}-${e.id}`,
          subQuestionId: sq.id,
          stance: e.stance as EvidenceStance,
          claim: sanClaim.text,
          reasoning:
            sanReason.text +
            `（防伪造校验：输出中含未见于数据载荷的数值，已替换为「见载荷」）`,
          payloadIds: (e.payloadIds as string[]).filter((pid) => sqPayloads.some((p) => p.id === pid)),
          confidence: e.confidence as number,
          status: (e.status as Evidence["status"]) ?? "ok",
        };
      }
      return {
        id: `EV-${sq.id}-${e.id}`,
        subQuestionId: sq.id,
        stance: e.stance as EvidenceStance,
        claim,
        reasoning,
        payloadIds: (e.payloadIds as string[]).filter((pid) => sqPayloads.some((p) => p.id === pid)),
        confidence: e.confidence as number,
        status: (e.status as Evidence["status"]) ?? "ok",
      };
    });
    evidences.push(...items);
    emit?.({ type: "evidence", items: evidences });
  }
  return { payloads, evidences };
}
