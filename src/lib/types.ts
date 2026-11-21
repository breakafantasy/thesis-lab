// 领域模型：投资命题 → 子问题 → 数据载荷 → 证据链 → 结论
// 设计红线：所有数值只存在于 DataPayload 中；AI 产出（claim/statement）禁止出现数值，只能引用载荷 ID。

export type DataSourceId = "fuyao" | "ifind" | "snapshot";

// ---------- 命题 ----------
export interface ClarificationQuestion {
  id: string;
  dimension: "标的" | "时间窗口" | "指标口径" | "对比基准" | "断言方向" | "其他";
  question: string;
  options: string[];
  defaultOption: string;
  why: string; // 为什么需要澄清（可追溯）
}

export interface Thesis {
  id: string;
  rawText: string; // 原始命题
  revisedText: string; // 修订后命题
  clarifications: { questionId: string; question: string; answer: string }[];
  elements: {
    subject?: string; // 标的
    timeWindow?: string;
    metric?: string; // 指标口径
    baseline?: string; // 对比基准
    claimDirection?: string;
  };
  revisionNotes: { from: string; to: string; reason: string }[]; // 修订记录
}

// ---------- 子问题 ----------
export interface DataNeed {
  source: DataSourceId; // 期望数据源（fuyao/ifind）
  kind: string; // 查询类型：quote/kline/financial/indicator/valuation/index/sector/announcements/research/industry/company
  params: Record<string, string>; // 结构化查询参数
  queryDescription: string; // 人类可读的查询说明
}

export interface SubQuestion {
  id: string;
  text: string;
  verifiable: boolean; // 是否可验证（不可验证时 dataNeeds 为空，进入「无法验证」证据）
  metricSpec: string; // 验证口径
  dataNeeds: DataNeed[];
}

// ---------- 数据载荷（数值唯一居所） ----------
export interface DataPoint {
  label: string; // 如「2024 年归母净利润」
  period?: string; // 报告期
  value: number | string;
  unit?: string;
}

export interface MaterialRef {
  type: "announcement" | "research" | "filing" | "other";
  title: string;
  source: string; // 出处（交易所/巨潮/iFinD/内置快照）
  date?: string;
  url?: string;
  quote?: string; // 关键原文摘录
}

export interface DataPayload {
  id: string;
  subQuestionId: string;
  source: DataSourceId; // 实际来源（降级后为 snapshot）
  requestedSource: DataSourceId;
  status: "ok" | "degraded" | "error" | "empty";
  statusNote?: string; // 异常/降级说明
  fetchedAt: string;
  points: DataPoint[];
  materials: MaterialRef[];
  raw?: unknown; // 接口原始返回（裁剪后，用于追溯）
}

// ---------- 证据 ----------
export type EvidenceStance = "support" | "oppose" | "unverifiable" | "partial";

export interface Evidence {
  id: string;
  subQuestionId: string;
  stance: EvidenceStance;
  claim: string; // 证据主张（AI 撰写；不得含数值，数值由 UI 从载荷渲染）
  reasoning: string; // 归类理由（可审计）
  payloadIds: string[]; // 引用的数据载荷
  confidence: number; // 0-1
  status: "ok" | "degraded" | "empty";
}

// ---------- 冲突与结论 ----------
export interface ConflictPair {
  id: string;
  evidenceA: string; // evidence id
  evidenceB: string;
  dimension: "口径差异" | "时间窗口" | "来源权威性" | "样本量" | "其他";
  resolution: string; // 仲裁结论
  ruleApplied: string; // 应用的仲裁规则
}

export type VerdictLevel = "support" | "partial_support" | "unsupported" | "undetermined";

export interface ReversalCondition {
  id: string;
  description: string; // 什么信息变化
  trigger: string; // 具体阈值/事件（锚定当前载荷值）
  effect: string; // 结论将如何变化
  monitor: { source: DataSourceId; kind: string; params: Record<string, string> }; // 监测数据源
}

export interface Verdict {
  level: VerdictLevel;
  statement: string; // 结论陈述（引用证据 ID，不含数值）
  confidence: number; // 0-1
  evidenceIndex: { evidenceId: string; stance: EvidenceStance }[];
  conflicts: ConflictPair[];
  reversalConditions: ReversalCondition[];
}

// ---------- 验证任务（保存为研究任务） ----------
export interface Followup {
  question: string;
  answer: string;
  referencedEvidenceIds: string[];
  at: string;
}

export interface VerificationTask {
  id: string;
  createdAt: string;
  thesis: Thesis;
  subQuestions: SubQuestion[];
  payloads: DataPayload[];
  evidences: Evidence[];
  verdict: Verdict;
  followups: Followup[];
}

// ---------- 管线事件（SSE 推送） ----------
export type PipelineEvent =
  | { type: "stage"; stage: string; message: string }
  | { type: "clarify"; questions: ClarificationQuestion[]; elements: Thesis["elements"] }
  | { type: "advisory"; guidance: string; rewrittenThesis: string }
  | { type: "thesis"; thesis: Thesis }
  | { type: "subquestions"; items: SubQuestion[] }
  | { type: "payload"; payload: DataPayload }
  | { type: "evidence"; items: Evidence[] }
  | { type: "conflicts"; conflicts: ConflictPair[] }
  | { type: "verdict"; verdict: Verdict }
  | { type: "done"; task: VerificationTask }
  | { type: "error"; stage: string; message: string };

export const STANCE_LABEL: Record<EvidenceStance, string> = {
  support: "支持",
  oppose: "反对",
  unverifiable: "无法验证",
  partial: "部分支持",
};

export const VERDICT_LABEL: Record<VerdictLevel, string> = {
  support: "支持命题",
  partial_support: "部分支持",
  unsupported: "不支持",
  undetermined: "无法判断",
};
