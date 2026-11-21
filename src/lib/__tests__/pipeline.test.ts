// 主链路集成测试：mock LLM + 内置快照数据，覆盖 主链路/接口异常/合规边界/防伪造

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setChatOverride } from "@/lib/llm";
import { runVerification, type RunOptions } from "@/lib/pipeline";
import { collectKnownNumbers, findForeignNumbers } from "@/lib/pipeline/decompose";
import type { PipelineEvent, VerificationTask } from "@/lib/types";

const THESIS = "测试股份 2024 年盈利改善主要来自主营业务";
const ANSWERS = [{ questionId: "q1", question: "盈利改善指哪个口径？", answer: "归母净利润" }];

function mockLLM() {
  __setChatOverride(async (messages) => {
    const system = messages[0]?.content ?? "";
    const user = messages.at(-1)?.content ?? "";

    if (system.includes("分析用户输入的投资命题")) {
      if (user.includes("该不该买")) {
        return JSON.stringify({
          isAdvisory: true,
          advisoryGuidance: "本产品不提供买卖建议。你可以把判断改写为一个可验证命题，例如「XX 公司盈利改善来自主营业务」。",
          rewrittenThesis: "测试股份 2024 年盈利改善主要来自主营业务",
        });
      }
      if (user.includes("无歧义")) {
        return JSON.stringify({
          isAdvisory: false,
          elements: { subject: "测试股份", timeWindow: "2024 年", metric: "归母净利润", baseline: "2023 年", claimDirection: "改善" },
          ambiguities: [],
        });
      }
      return JSON.stringify({
        isAdvisory: false,
        elements: { subject: "测试股份", timeWindow: "2024 年", metric: "", baseline: "", claimDirection: "改善" },
        ambiguities: [
          {
            id: "q1",
            dimension: "指标口径",
            question: "盈利改善指哪个口径？",
            options: ["归母净利润", "扣非净利润"],
            defaultOption: "归母净利润",
            why: "口径不同，结论可能完全翻转",
          },
        ],
      });
    }

    if (system.includes("修订投资命题")) {
      const input = JSON.parse(user) as { rawText: string };
      const uncovered = input.rawText.includes("未覆盖标的");
      return JSON.stringify({
        revisedText: uncovered
          ? "某未覆盖标的 2024 年归母净利润同比改善"
          : "测试股份 2024 年归母净利润改善主要来自主营业务",
        revisionNotes: [{ from: "盈利改善", to: "归母净利润改善", reason: "按用户确认的口径修订" }],
      });
    }

    if (system.includes("拆解为可验证子问题")) {
      const uncovered = user.includes("未覆盖标的");
      const codes = uncovered ? "999999.SZ" : "000000.SZ";
      const keyword = uncovered ? "未覆盖标的" : "测试股份";
      return JSON.stringify({
        subQuestions: [
          {
            id: "sq1",
            text: "营业收入是否同比增长？",
            verifiable: true,
            metricSpec: "2024 年营业收入 > 2023 年即支持",
            dataNeeds: [
              { source: "fuyao", kind: "indicator", params: { codes, periods: "2024-12-31,2023-12-31", fields: "revenue" }, queryDescription: "营业收入两年对比" },
            ],
          },
          {
            id: "sq2",
            text: "扣非净利润增速是否与归母净利润一致？",
            verifiable: true,
            metricSpec: "扣非增速 ≥ 归母增速即支持，否则反对",
            dataNeeds: [
              { source: "fuyao", kind: "indicator", params: { codes, periods: "2024-12-31,2023-12-31", fields: "deducted_net_profit" }, queryDescription: "扣非净利润两年对比" },
            ],
          },
          {
            id: "sq3",
            text: "年报是否披露非经常性损益明细？",
            verifiable: true,
            metricSpec: "公告披露即支持",
            dataNeeds: [
              { source: "ifind", kind: "announcements", params: { codes, keyword }, queryDescription: "年报公告检索" },
            ],
          },
          {
            id: "sq4",
            text: "管理层访谈是否确认主营贡献？",
            verifiable: false,
            metricSpec: "现有数据源不可验证",
            dataNeeds: [],
          },
        ],
      });
    }

    if (system.includes("组织证据条目")) {
      const input = JSON.parse(user) as { 子问题: { id: string }; 数据载荷: { id: string }[] };
      const sqId = input.子问题.id;
      const payloadIds = input.数据载荷.map((p) => p.id);
      if (sqId.includes("2")) {
        return JSON.stringify({
          items: [
            { id: "evA", subQuestionId: sqId, stance: "support", claim: "扣非增速高于归母增速（见载荷）", reasoning: "载荷对比支持", payloadIds, confidence: 0.8, status: "ok" },
            { id: "evB", subQuestionId: sqId, stance: "oppose", claim: "扣非绝对规模远小于归母（见载荷）", reasoning: "载荷对比反对", payloadIds, confidence: 0.8, status: "ok" },
          ],
        });
      }
      if (sqId.includes("3")) {
        // 故意在 claim 中写一个载荷外的数值，验证防伪造兜底
        return JSON.stringify({
          items: [
            { id: "evA", subQuestionId: sqId, stance: "support", claim: "该公告披露净利润 9999 万元（见载荷）", reasoning: "公告材料支持", payloadIds, confidence: 0.7, status: "ok" },
          ],
        });
      }
      return JSON.stringify({
        items: [
          { id: "evA", subQuestionId: sqId, stance: "support", claim: "数据支持该子问题断言（见载荷）", reasoning: "载荷显示对应变化", payloadIds, confidence: 0.8, status: "ok" },
        ],
      });
    }

    if (system.includes("处理证据冲突")) {
      const input = JSON.parse(user) as { 冲突对: { evidenceA: string; evidenceB: string }[] };
      return JSON.stringify({
        conflicts: input.冲突对.map((p, i) => ({
          id: `cf${i + 1}`,
          evidenceA: p.evidenceA,
          evidenceB: p.evidenceB,
          dimension: "口径差异",
          resolution: "两条证据回答不同口径，按命题口径（归母净利润）采纳其一，另一条保留为参考",
          ruleApplied: "口径差异规则（优先级最高）",
        })),
      });
    }

    if (system.includes("可追溯结论")) {
      const input = JSON.parse(user) as { 证据: { id: string; stance: string }[] };
      return JSON.stringify({
        level: "partial_support",
        statement: "命题得到部分支持：主营收入增长与公告披露形成支持，但扣非口径存在实质反对（见证据）。",
        confidence: 0.7,
        evidenceIndex: input.证据.map((e) => ({ evidenceId: e.id, stance: e.stance })),
        reversalConditions: [
          { id: "rc1", description: "下一报告期扣非净利润增速超过归母净利润增速", trigger: "见载荷", effect: "结论翻转为支持", monitor: { source: "fuyao", kind: "indicator", params: { codes: "000000.SZ" } } },
          { id: "rc2", description: "年报补丁公告修正非经常性损益为负数", trigger: "见载荷", effect: "结论翻转为支持", monitor: { source: "ifind", kind: "announcements", params: { keyword: "测试股份" } } },
        ],
      });
    }

    throw new Error(`测试 mock 未覆盖的调用：${system.slice(0, 60)}`);
  });
}

async function collect(opts: RunOptions): Promise<{ events: PipelineEvent[]; result: Awaited<ReturnType<typeof runVerification>> }> {
  const events: PipelineEvent[] = [];
  const result = await runVerification(opts, (e) => events.push(e));
  return { events, result };
}

beforeEach(() => {
  mockLLM();
  delete process.env.FUYAO_BASE_URL;
  delete process.env.IFIND_MCP_URL;
});

afterEach(() => {
  __setChatOverride(null);
  delete process.env.FUYAO_BASE_URL;
  delete process.env.IFIND_MCP_URL;
});

describe("主链路", () => {
  it("存在关键歧义时先中断澄清，再携带答案完成全链路", async () => {
    // 第一轮：无澄清答案 → 中断并返回澄清问题
    const first = await collect({ thesisText: THESIS });
    expect(first.result.kind).toBe("interrupted");
    expect(first.events.some((e) => e.type === "clarify")).toBe(true);
    const clarifyEvent = first.events.find((e) => e.type === "clarify");
    if (clarifyEvent?.type !== "clarify") throw new Error("缺少 clarify 事件");
    expect(clarifyEvent.questions.length).toBe(1);

    // 第二轮：携带答案 → 完成
    const second = await collect({ thesisText: THESIS, clarifications: ANSWERS });
    expect(second.result.kind).toBe("task");
    const task = (second.result as { kind: "task"; task: VerificationTask }).task;

    // 修订可追溯
    expect(task.thesis.revisedText).toContain("归母净利润");
    expect(task.thesis.revisionNotes.length).toBeGreaterThanOrEqual(1);
    expect(task.thesis.clarifications[0].answer).toBe("归母净利润");

    // 拆解：4 个子问题，其中 1 个不可验证
    expect(task.subQuestions.length).toBe(4);
    expect(task.subQuestions.find((s) => !s.verifiable)?.text).toContain("管理层访谈");

    // 证据链：三分类齐全
    const stances = task.evidences.map((e) => e.stance);
    expect(stances).toContain("support");
    expect(stances).toContain("oppose");
    expect(stances).toContain("unverifiable");

    // 载荷：真实源未配置 → 降级快照且如实标注
    expect(task.payloads.length).toBe(3);
    for (const p of task.payloads) {
      expect(p.source).toBe("snapshot");
      expect(p.statusNote).toContain("降级");
    }

    // 冲突检测与仲裁
    expect(task.verdict.conflicts.length).toBe(1);
    expect(task.verdict.conflicts[0].dimension).toBe("口径差异");

    // 结论与反转条件
    expect(task.verdict.level).toBe("partial_support");
    expect(task.verdict.reversalConditions.length).toBeGreaterThanOrEqual(2);
    expect(task.verdict.evidenceIndex.length).toBe(task.evidences.length);

    // 事件序列完整
    const types = second.events.map((e) => e.type);
    for (const t of ["thesis", "subquestions", "payload", "evidence", "conflicts", "verdict", "done"]) {
      expect(types).toContain(t);
    }
  });

  it("无歧义命题可一次跑通", async () => {
    const { result } = await collect({ thesisText: "无歧义命题：测试股份 2024 年归母净利润同比改善" });
    expect(result.kind).toBe("task");
  });
});

describe("防伪造", () => {
  it("AI 输出中载荷之外的数值被替换为「见载荷」", async () => {
    const { result } = await collect({ thesisText: THESIS, clarifications: ANSWERS });
    expect(result.kind).toBe("task");
    const task = (result as { kind: "task"; task: VerificationTask }).task;
    const known = collectKnownNumbers(task.payloads);
    for (const e of task.evidences) {
      expect(findForeignNumbers(e.claim, known)).toEqual([]);
      expect(findForeignNumbers(e.reasoning, known)).toEqual([]);
    }
    expect(findForeignNumbers(task.verdict.statement, known)).toEqual([]);
    // mock 中故意写入的 9999 已被替换
    const sq3Claims = task.evidences.filter((e) => e.subQuestionId.includes("3")).map((e) => e.claim).join(" ");
    expect(sq3Claims).not.toContain("9999");
    expect(sq3Claims).toContain("见载荷");
  });
});

describe("合规边界", () => {
  it("荐股式提问被拦截并引导为可验证命题", async () => {
    const { events, result } = await collect({ thesisText: "现在该不该买测试股份？" });
    expect(result.kind).toBe("interrupted");
    const advisory = events.find((e) => e.type === "advisory");
    if (advisory?.type !== "advisory") throw new Error("缺少 advisory 事件");
    expect(advisory.guidance).toContain("不提供买卖建议");
    expect(advisory.rewrittenThesis.length).toBeGreaterThan(0);
  });
});

describe("接口异常", () => {
  it("故障演示模式下真实源被标记异常并降级到快照", async () => {
    process.env.FUYAO_BASE_URL = "http://127.0.0.1:9";
    const { result } = await collect({ thesisText: THESIS, clarifications: ANSWERS, faultDemo: true });
    expect(result.kind).toBe("task");
    const task = (result as { kind: "task"; task: VerificationTask }).task;
    expect(task.payloads.length).toBe(3);
    for (const p of task.payloads) {
      expect(p.statusNote).toContain("模拟故障");
      expect(p.source).toBe("snapshot");
    }
  });

  it("无可用数据源且快照未命中时形成「无法验证」证据，结论被强制降级", async () => {
    // 使用一个快照未覆盖的标的：所有真实源不可用 → 载荷 empty → 无法验证
    const { result } = await collect({ thesisText: "无歧义命题：某未覆盖标的 2024 年归母净利润同比改善" });
    expect(result.kind).toBe("task");
    const task = (result as { kind: "task"; task: VerificationTask }).task;
    const unverifiable = task.evidences.filter((e) => e.stance === "unverifiable");
    expect(unverifiable.length).toBeGreaterThan(0);
    expect(task.verdict.level).toBe("undetermined");
    expect(task.verdict.confidence).toBeLessThanOrEqual(0.6);
  });
});
