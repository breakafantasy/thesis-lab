// 命题验证台 · Thesis Lab —— 主页面
// 状态编排 + SSE 流解析 + 研究任务管理 + 命题比较

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClarificationQuestion,
  ConflictPair,
  DataPayload,
  Evidence,
  Followup,
  PipelineEvent,
  SubQuestion,
  Thesis,
  VerificationTask,
  Verdict,
} from "@/lib/types";
import type { ClarificationAnswer } from "@/lib/pipeline/clarify";
import { downloadTask, loadTasks, saveTasks } from "@/lib/client-store";
import ThesisComposer, { type Phase } from "@/components/ThesisComposer";
import VerificationView from "@/components/VerificationView";
import TaskDrawer from "@/components/TaskDrawer";
import { StanceBadge, VerdictBadge } from "@/components/ui";

interface Draft {
  thesis?: Thesis;
  subQuestions?: SubQuestion[];
  payloads?: DataPayload[];
  evidences?: Evidence[];
  conflicts?: ConflictPair[];
  verdict?: Verdict;
}

interface Health {
  llm: boolean;
  fuyao: boolean;
  ifind: boolean;
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState("");
  const [clarify, setClarify] = useState<{ questions: ClarificationQuestion[] } | null>(null);
  const [advisory, setAdvisory] = useState<{ guidance: string; rewrittenThesis: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [asking, setAsking] = useState(false);
  const [tasks, setTasks] = useState<VerificationTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [faultDemo, setFaultDemo] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const draftRef = useRef<Draft>({});

  useEffect(() => {
    setTasks(loadTasks());
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setHealth(h))
      .catch(() => setHealth(null));
  }, []);

  const persist = useCallback((next: VerificationTask[]) => {
    setTasks(next);
    saveTasks(next);
  }, []);

  const dispatch = useCallback(
    (e: PipelineEvent) => {
      switch (e.type) {
        case "stage":
          setStage(e.stage);
          break;
        case "clarify":
          setClarify({ questions: e.questions });
          setPhase("clarifying");
          break;
        case "advisory":
          setAdvisory({ guidance: e.guidance, rewrittenThesis: e.rewrittenThesis });
          setPhase("advisory");
          break;
        case "thesis":
          draftRef.current = { ...draftRef.current, thesis: e.thesis };
          setDraft(draftRef.current);
          break;
        case "subquestions":
          draftRef.current = { ...draftRef.current, subQuestions: e.items };
          setDraft(draftRef.current);
          break;
        case "payload":
          draftRef.current = {
            ...draftRef.current,
            payloads: [...(draftRef.current.payloads ?? []).filter((p) => p.id !== e.payload.id), e.payload],
          };
          setDraft(draftRef.current);
          break;
        case "evidence":
          draftRef.current = { ...draftRef.current, evidences: e.items };
          setDraft(draftRef.current);
          break;
        case "conflicts":
          draftRef.current = { ...draftRef.current, conflicts: e.conflicts };
          setDraft(draftRef.current);
          break;
        case "verdict":
          draftRef.current = { ...draftRef.current, verdict: e.verdict };
          setDraft(draftRef.current);
          break;
        case "done": {
          const task = e.task;
          persist([task, ...tasksRef.current.filter((t) => t.id !== task.id)]);
          setActiveTaskId(task.id);
          setFollowups(task.followups);
          setPhase("done");
          break;
        }
        case "error":
          setError(e.message);
          setPhase("error");
          break;
      }
    },
    [persist]
  );
  const tasksRef = useRef<VerificationTask[]>([]);
  tasksRef.current = tasks;

  const run = useCallback(
    async (thesisText: string, clarifications?: ClarificationAnswer[]) => {
      setPhase("running");
      setError(null);
      setClarify(null);
      setAdvisory(null);
      setFollowups([]);
      draftRef.current = {};
      setDraft({});
      try {
        const res = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thesis: thesisText, clarifications: clarifications ?? [], faultDemo }),
        });
        if (!res.ok || !res.body) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            for (const line of chunk.split("\n")) {
              const t = line.trim();
              if (t.startsWith("data: ")) {
                try {
                  dispatch(JSON.parse(t.slice(6)) as PipelineEvent);
                } catch {
                  /* 跳过无法解析的事件 */
                }
              }
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "网络异常，验证中断");
        setPhase("error");
      }
    },
    [dispatch, faultDemo]
  );

  const ask = useCallback(
    async (question: string) => {
      const task = tasksRef.current.find((t) => t.id === activeTaskId);
      if (!task) return;
      setAsking(true);
      try {
        const res = await fetch("/api/followup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, question }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        const j = (await res.json()) as { answer: string; referencedEvidenceIds: string[] };
        const f: Followup = {
          question,
          answer: j.answer,
          referencedEvidenceIds: j.referencedEvidenceIds,
          at: new Date().toISOString(),
        };
        const updated = { ...task, followups: [...task.followups, f] };
        persist(tasksRef.current.map((t) => (t.id === updated.id ? updated : t)));
        setFollowups(updated.followups);
      } catch (e) {
        const f: Followup = {
          question,
          answer: `追问失败：${e instanceof Error ? e.message : "未知错误"}`,
          referencedEvidenceIds: [],
          at: new Date().toISOString(),
        };
        setFollowups((prev) => [...prev, f]);
      } finally {
        setAsking(false);
      }
    },
    [activeTaskId, persist]
  );

  const openTask = useCallback((id: string) => {
    const t = tasksRef.current.find((x) => x.id === id);
    if (!t) return;
    draftRef.current = {
      thesis: t.thesis,
      subQuestions: t.subQuestions,
      payloads: t.payloads,
      evidences: t.evidences,
      conflicts: t.verdict.conflicts,
      verdict: t.verdict,
    };
    setDraft(draftRef.current);
    setFollowups(t.followups);
    setActiveTaskId(id);
    setPhase("done");
    setDrawerOpen(false);
    setError(null);
  }, []);

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }, []);

  const deleteTask = useCallback(
    (id: string) => {
      persist(tasksRef.current.filter((t) => t.id !== id));
      setCompareIds((prev) => prev.filter((x) => x !== id));
      if (activeTaskId === id) setActiveTaskId(null);
    },
    [activeTaskId, persist]
  );

  const compareTasks = tasks.filter((t) => compareIds.includes(t.id));

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            <span className="mr-2 inline-block h-6 w-6 rounded bg-blue-600 text-center text-sm leading-6 text-white">验</span>
            命题验证台 <span className="text-sm font-normal text-gray-400">Thesis Lab</span>
          </h1>
          <p className="mt-1 text-xs text-gray-500">
            把投资命题变成可验证子问题与证据链，结论可追溯 · 不构成投资建议
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={faultDemo} onChange={(e) => setFaultDemo(e.target.checked)} />
            故障演示（模拟数据源异常）
          </label>
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:border-blue-300 hover:text-blue-600"
          >
            研究任务（{tasks.length}）
          </button>
        </div>
      </header>

      {compareTasks.length === 2 && (
        <section className="mt-4 rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">命题比较</h2>
            <button onClick={() => setCompareIds([])} className="text-xs text-gray-400 hover:text-gray-600">
              关闭比较
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            {compareTasks.map((t) => {
              const counts = { support: 0, oppose: 0, unverifiable: 0, partial: 0 };
              for (const e of t.evidences) counts[e.stance]++;
              return (
                <div key={t.id} className="rounded-lg border border-gray-200 p-4">
                  <p className="text-sm font-medium text-gray-900">{t.thesis.revisedText}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <VerdictBadge level={t.verdict.level} />
                    <span className="text-xs text-gray-400">置信度 {Math.round(t.verdict.confidence * 100)}%</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <StanceBadge stance="support" /> {counts.support}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <StanceBadge stance="oppose" /> {counts.oppose}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <StanceBadge stance="partial" /> {counts.partial}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <StanceBadge stance="unverifiable" /> {counts.unverifiable}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-gray-600">{t.verdict.statement}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    证据冲突 {t.verdict.conflicts.length} 项 · 反转条件 {t.verdict.reversalConditions.length} 条 ·{" "}
                    {new Date(t.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <main className="mt-4 space-y-4">
        <ThesisComposer
          phase={phase}
          clarify={clarify}
          advisory={advisory}
          error={error}
          onRun={run}
          onAdvisoryUse={(t) => run(t)}
        />
        <VerificationView
          thesis={draft.thesis}
          subQuestions={draft.subQuestions}
          payloads={draft.payloads}
          evidences={draft.evidences}
          conflicts={draft.conflicts}
          verdict={draft.verdict}
          stage={stage}
          running={phase === "running"}
          task={tasks.find((t) => t.id === activeTaskId) ?? null}
          followups={followups}
          asking={asking}
          onAsk={ask}
        />
      </main>

      <footer className="mt-8 space-y-2 border-t border-gray-200 pt-4 text-xs text-gray-400">
        <p>
          <span className="font-medium text-gray-500">免责声明：</span>
          本产品仅提供投资命题的信息整理与证据验证，全部数值来自数据源接口或内置公开数据快照（以证据载荷标注为准），不构成任何投资建议，不推荐买卖，不预测涨跌。
        </p>
        <p>
          数据源状态：
          {health ? (
            <span className="font-mono">
              LLM{health.llm ? " ✓" : " ✗"} · 扶摇{health.fuyao ? " ✓" : " ✗"} · iFinD MCP{health.ifind ? " ✓" : " ✗"} · 内置快照 ✓
            </span>
          ) : (
            <span className="font-mono">检测中…</span>
          )}
        </p>
      </footer>

      <TaskDrawer
        open={drawerOpen}
        tasks={tasks}
        activeId={activeTaskId}
        compareIds={compareIds}
        onOpenTask={openTask}
        onToggleCompare={toggleCompare}
        onExport={downloadTask}
        onDelete={deleteTask}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
