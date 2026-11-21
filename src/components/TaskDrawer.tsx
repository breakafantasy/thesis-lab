// 研究任务抽屉：保存的研究任务列表（打开 / 比较 / 导出 / 删除）

"use client";

import type { VerificationTask } from "@/lib/types";
import { VerdictBadge } from "./ui";

interface Props {
  open: boolean;
  tasks: VerificationTask[];
  activeId: string | null;
  compareIds: string[];
  onOpenTask: (id: string) => void;
  onToggleCompare: (id: string) => void;
  onExport: (task: VerificationTask) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function TaskDrawer({ open, tasks, activeId, compareIds, onOpenTask, onToggleCompare, onExport, onDelete, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">研究任务（{tasks.length}）</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {tasks.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">暂无保存的研究任务。完成一次验证后会自动保存。</p>
          )}
          {tasks.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg border p-3 ${t.id === activeId ? "border-blue-300 bg-blue-50/40" : "border-gray-200 bg-white"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-gray-900">{t.thesis.revisedText}</p>
                <VerdictBadge level={t.verdict.level} />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {new Date(t.createdAt).toLocaleString("zh-CN")} · {t.evidences.length} 条证据 · 置信度{" "}
                {Math.round(t.verdict.confidence * 100)}%
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  onClick={() => onOpenTask(t.id)}
                  className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700"
                >
                  打开
                </button>
                <button
                  onClick={() => onToggleCompare(t.id)}
                  className={`rounded border px-2.5 py-1 text-xs ${
                    compareIds.includes(t.id)
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-300 text-gray-600 hover:border-blue-300"
                  }`}
                >
                  {compareIds.includes(t.id) ? "已加入比较" : "加入比较"}
                </button>
                <button
                  onClick={() => onExport(t)}
                  className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:border-blue-300"
                >
                  导出
                </button>
                <button
                  onClick={() => onDelete(t.id)}
                  className="rounded border border-gray-300 px-2.5 py-1 text-xs text-red-500 hover:border-red-300"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
