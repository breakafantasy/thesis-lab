// 命题输入区：命题输入、示例、澄清对话框、荐股式输入合规引导

"use client";

import { useState } from "react";
import type { ClarificationQuestion } from "@/lib/types";
import type { ClarificationAnswer } from "@/lib/pipeline/clarify";

const EXAMPLES = [
  "贵州茅台 2024 年盈利改善主要来自主营业务",
  "宁德时代估值回落但基本面未恶化",
  "新能源汽车购置税优惠退坡将影响产业链利润分配",
];

export type Phase = "idle" | "clarifying" | "running" | "done" | "error" | "advisory";

interface Props {
  phase: Phase;
  clarify: { questions: ClarificationQuestion[] } | null;
  advisory: { guidance: string; rewrittenThesis: string } | null;
  error: string | null;
  onRun: (thesis: string, clarifications?: ClarificationAnswer[]) => void;
  onAdvisoryUse: (text: string) => void;
}

export default function ThesisComposer({ phase, clarify, advisory, error, onRun, onAdvisoryUse }: Props) {
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const busy = phase === "running";

  const submit = () => {
    if (!text.trim() || busy) return;
    if (phase === "clarifying" && clarify) {
      const clarifications: ClarificationAnswer[] = clarify.questions
        .filter((q) => (answers[q.id] ?? q.defaultOption).trim())
        .map((q) => ({ questionId: q.id, question: q.question, answer: answers[q.id] ?? q.defaultOption }));
      onRun(text, clarifications);
    } else {
      onRun(text);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">输入投资命题</h2>
      <p className="mt-1 text-xs text-gray-500">
        一句话描述你想验证的判断。产品会先澄清口径，再拆解子问题、调用数据形成证据链。
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        rows={3}
        placeholder="例如：贵州茅台 2024 年盈利改善主要来自主营业务"
        className="mt-3 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400">示例：</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            disabled={busy}
            onClick={() => setText(ex)}
            className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      {phase === "clarifying" && clarify && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
          <h3 className="text-sm font-semibold text-blue-800">命题存在关键歧义，请确认口径</h3>
          <p className="mt-1 text-xs text-blue-600">不确认的项将采用默认口径；修订记录会如实保留。</p>
          <div className="mt-3 space-y-3">
            {clarify.questions.map((q) => {
              const val = answers[q.id] ?? q.defaultOption;
              return (
                <div key={q.id} className="rounded-md bg-white p-3">
                  <p className="text-sm text-gray-800">
                    {q.question}
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{q.dimension}</span>
                  </p>
                  <p className="mt-1 text-xs text-gray-400">为什么需要澄清：{q.why}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {q.options.map((opt) => (
                      <label
                        key={opt}
                        className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                          val === opt
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-gray-300 bg-white text-gray-600 hover:border-blue-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name={q.id}
                          className="hidden"
                          checked={val === opt}
                          onChange={() => setAnswers((s) => ({ ...s, [q.id]: opt }))}
                        />
                        {opt}
                      </label>
                    ))}
                    <input
                      value={val && !q.options.includes(val) ? val : ""}
                      onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: e.target.value }))}
                      placeholder="自定义口径…"
                      className="w-40 rounded-full border border-gray-300 px-3 py-1 text-xs focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {phase === "advisory" && advisory && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-800">这不是一个可验证的命题</h3>
          <p className="mt-1 text-sm text-amber-700">{advisory.guidance}</p>
          {advisory.rewrittenThesis && (
            <div className="mt-3 rounded-md bg-white p-3">
              <p className="text-xs text-gray-400">建议改写为：</p>
              <p className="mt-1 text-sm text-gray-800">{advisory.rewrittenThesis}</p>
              <button
                onClick={() => onAdvisoryUse(advisory.rewrittenThesis)}
                className="mt-2 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
              >
                使用改写后的命题
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "error" && error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">验证中断</p>
          <p className="mt-1 text-xs">{error}</p>
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !text.trim()}
        className="mt-4 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {busy ? "验证中…" : phase === "clarifying" ? "确认口径，开始验证" : "开始验证"}
      </button>
    </section>
  );
}
