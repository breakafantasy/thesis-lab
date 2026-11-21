// 验证结果视图：阶段进度、命题卡、子问题、证据链、冲突、结论与反转条件、追问

"use client";

import { useState } from "react";
import type {
  ConflictPair,
  DataPayload,
  Evidence,
  Followup,
  SubQuestion,
  Thesis,
  VerificationTask,
  Verdict,
} from "@/lib/types";
import { ConfidenceBar, EvidenceRefText, StanceBadge, VerdictBadge } from "./ui";

const STAGES = ["解析", "澄清", "拆解", "证据", "仲裁", "结论"];
const stageIndex: Record<string, number> = {
  parse: 0,
  revise: 1,
  decompose: 2,
  evidence: 3,
  arbitrate: 4,
  conclude: 5,
};

interface Props {
  thesis?: Thesis;
  subQuestions?: SubQuestion[];
  payloads?: DataPayload[];
  evidences?: Evidence[];
  conflicts?: ConflictPair[];
  verdict?: Verdict;
  stage: string;
  running: boolean;
  task: VerificationTask | null;
  followups: Followup[];
  asking: boolean;
  onAsk: (q: string) => void;
}

function StageTimeline({ stage, running }: { stage: string; running: boolean }) {
  const active = stageIndex[stage] ?? -1;
  return (
    <div className="flex items-center gap-1.5">
      {STAGES.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              i < active || (!running && active >= 0)
                ? "bg-blue-600 text-white"
                : i === active && running
                  ? "animate-pulse bg-blue-200 text-blue-700"
                  : "bg-gray-200 text-gray-500"
            }`}
          >
            {i < active || (!running && active >= 0) ? "✓" : i + 1}
          </span>
          <span className={`text-xs ${i === active ? "font-medium text-blue-700" : "text-gray-500"}`}>{s}</span>
          {i < STAGES.length - 1 && <span className="h-px w-3 bg-gray-300" />}
        </div>
      ))}
    </div>
  );
}

function ThesisCard({ thesis }: { thesis: Thesis }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">修订后命题</h3>
      <p className="mt-2 text-base font-medium text-gray-900">{thesis.revisedText}</p>
      <p className="mt-2 text-xs text-gray-400">原始输入：{thesis.rawText}</p>
      {thesis.clarifications.length > 0 && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-500">澄清确认</p>
          <ul className="mt-1 space-y-1 text-xs text-gray-600">
            {thesis.clarifications.map((c) => (
              <li key={c.questionId}>
                · {c.question} → <span className="font-medium text-gray-900">{c.answer}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {thesis.revisionNotes.length > 0 && (
        <div className="mt-3 rounded-lg bg-blue-50/60 p-3">
          <p className="text-xs font-medium text-blue-800">修订记录（可追溯）</p>
          <ul className="mt-1 space-y-1 text-xs text-blue-700">
            {thesis.revisionNotes.map((n, i) => (
              <li key={i}>
                · 「{n.from}」→「{n.to}」：{n.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PayloadDetail({ payload }: { payload: DataPayload }) {
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-white">{payload.source}</span>
        <span className="text-gray-500">请求来源：{payload.requestedSource}</span>
        <span className="text-gray-400">获取时间：{new Date(payload.fetchedAt).toLocaleString("zh-CN")}</span>
      </div>
      {payload.statusNote && (
        <p className={`mt-1.5 ${payload.status === "ok" && payload.source !== "snapshot" ? "text-gray-500" : "text-amber-700"}`}>
          {payload.status === "ok" && payload.source === "snapshot" ? "⚠ " : ""}
          {payload.statusNote}
        </p>
      )}
      {payload.points.length > 0 && (
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="border-b border-gray-200 py-1 font-normal">指标</th>
              <th className="border-b border-gray-200 py-1 font-normal">报告期</th>
              <th className="border-b border-gray-200 py-1 font-normal">数值</th>
            </tr>
          </thead>
          <tbody>
            {payload.points.map((p, i) => (
              <tr key={i}>
                <td className="border-b border-gray-100 py-1 text-gray-700">{p.label}</td>
                <td className="border-b border-gray-100 py-1 text-gray-500">{p.period ?? "—"}</td>
                <td className="border-b border-gray-100 py-1 font-mono text-gray-900">
                  {String(p.value)}
                  {p.unit ? ` ${p.unit}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {payload.materials.length > 0 && (
        <div className="mt-2 space-y-2">
          {payload.materials.map((m, i) => (
            <div key={i} className="rounded bg-white p-2">
              <p className="font-medium text-gray-800">
                {m.title} <span className="ml-1 text-gray-400">({m.source}{m.date ? ` · ${m.date}` : ""})</span>
              </p>
              {m.quote && <p className="mt-1 whitespace-pre-wrap text-gray-600">“{m.quote}”</p>}
            </div>
          ))}
        </div>
      )}
      {payload.raw != null && (
        <details className="mt-2">
          <summary className="cursor-pointer text-gray-400 hover:text-gray-600">查看接口原始返回</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-900 p-2 text-[10px] leading-relaxed text-gray-300">
            {JSON.stringify(payload.raw, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

export default function VerificationView({
  thesis,
  subQuestions = [],
  payloads = [],
  evidences = [],
  conflicts = [],
  verdict,
  stage,
  running,
  task,
  followups,
  asking,
  onAsk,
}: Props) {
  const [openPayload, setOpenPayload] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  if (!thesis && !running) return null;

  const payloadById = new Map(payloads.map((p) => [p.id, p]));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-sm">
        <StageTimeline stage={stage} running={running} />
      </div>

      {thesis && <ThesisCard thesis={thesis} />}

      {subQuestions.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">可验证子问题（{subQuestions.length}）</h3>
          <ol className="mt-3 space-y-2">
            {subQuestions.map((sq, i) => (
              <li key={sq.id} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm text-gray-800">{sq.text}</p>
                    <p className="mt-1 text-xs text-gray-500">验证口径：{sq.metricSpec}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {!sq.verifiable && (
                        <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                          现有数据源不可验证
                        </span>
                      )}
                      {sq.dataNeeds.map((n, j) => (
                        <span key={j} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                          {n.source}/{n.kind} · {n.queryDescription}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {evidences.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">证据链（{evidences.length} 条）</h3>
          <div className="mt-3 space-y-3">
            {subQuestions.map((sq) => {
              const sqEv = evidences.filter((e) => e.subQuestionId === sq.id);
              if (sqEv.length === 0) return null;
              return (
                <div key={sq.id} className="rounded-lg border border-gray-100 p-3">
                  <p className="text-xs font-medium text-gray-500">{sq.text}</p>
                  <div className="mt-2 space-y-2">
                    {sqEv.map((e) => (
                      <div
                        key={e.id}
                        id={`ev-${e.id}`}
                        className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 transition-shadow"
                      >
                        <div className="flex items-center gap-2">
                          <StanceBadge stance={e.stance} />
                          <span className="font-mono text-[10px] text-gray-400">{e.id}</span>
                          {e.status !== "ok" && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                              数据{e.status === "empty" ? "缺失" : "降级"}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-sm text-gray-800">{e.claim}</p>
                        <p className="mt-1 text-xs text-gray-500">归类理由：{e.reasoning}</p>
                        {e.payloadIds.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {e.payloadIds.map((pid) => (
                              <button
                                key={pid}
                                onClick={() => setOpenPayload(openPayload === pid ? null : pid)}
                                className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 hover:bg-blue-100"
                              >
                                {pid} {openPayload === pid ? "▴" : "▾"}
                              </button>
                            ))}
                          </div>
                        )}
                        {openPayload && e.payloadIds.includes(openPayload) && payloadById.get(openPayload) && (
                          <PayloadDetail payload={payloadById.get(openPayload)!} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-amber-800">证据冲突与仲裁（{conflicts.length}）</h3>
          <div className="mt-3 space-y-2">
            {conflicts.map((c) => (
              <div key={c.id} className="rounded-lg border border-amber-200 bg-white p-3 text-sm">
                <p className="flex items-center gap-2 font-mono text-xs">
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">{c.evidenceA}</span>
                  <span className="text-amber-600">⇄</span>
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">{c.evidenceB}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{c.dimension}</span>
                </p>
                <p className="mt-1.5 text-gray-800">{c.resolution}</p>
                <p className="mt-1 text-xs text-gray-500">适用规则：{c.ruleApplied}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {verdict && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-900">结论</h3>
            <VerdictBadge level={verdict.level} />
            <ConfidenceBar value={verdict.confidence} />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-gray-800">
            <EvidenceRefText text={verdict.statement} />
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-400">结论依据：</span>
            {verdict.evidenceIndex.map((x) => (
              <span
                key={x.evidenceId}
                onClick={() => {
                  const el = document.getElementById(`ev-${x.evidenceId}`);
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="flex cursor-pointer items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-[10px] text-gray-600 hover:border-blue-300"
              >
                {x.evidenceId} <StanceBadge stance={x.stance} />
              </span>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
            <h4 className="text-xs font-semibold text-blue-800">哪些信息变化会改变当前结论（{verdict.reversalConditions.length}）</h4>
            <div className="mt-2 space-y-2">
              {verdict.reversalConditions.map((rc) => (
                <div key={rc.id} className="rounded bg-white p-3 text-sm">
                  <p className="font-medium text-gray-900">{rc.description}</p>
                  <p className="mt-1 text-gray-700">
                    <span className="font-medium text-blue-700">触发条件：</span>
                    {rc.trigger}
                  </p>
                  <p className="mt-1 text-gray-700">
                    <span className="font-medium text-blue-700">结论变化：</span>
                    {rc.effect}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-gray-400">
                    监测查询：{rc.monitor.source}/{rc.monitor.kind} {JSON.stringify(rc.monitor.params)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {task && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">继续追问</h3>
          <div className="mt-3 space-y-2">
            {followups.map((f, i) => (
              <div key={i} className="rounded-lg border border-gray-100 p-3">
                <p className="text-sm font-medium text-gray-800">问：{f.question}</p>
                <p className="mt-1 text-sm text-gray-700">
                  答：<EvidenceRefText text={f.answer} />
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && question.trim() && !asking) {
                  onAsk(question.trim());
                  setQuestion("");
                }
              }}
              placeholder="基于当前证据链继续提问，例如：扣非口径下的结论会不同吗？"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={() => {
                if (question.trim() && !asking) {
                  onAsk(question.trim());
                  setQuestion("");
                }
              }}
              disabled={asking || !question.trim()}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-900 disabled:bg-gray-300"
            >
              {asking ? "回答中…" : "追问"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
