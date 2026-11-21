// 研究任务本地持久化（演示级单用户；localStorage + 导出/导入）

"use client";

import type { VerificationTask } from "./types";

const KEY = "thesis-lab:tasks";

export function loadTasks(): VerificationTask[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveTasks(tasks: VerificationTask[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tasks));
  } catch {
    /* 存储已满等异常不影响主流程 */
  }
}

export function downloadTask(task: VerificationTask) {
  const blob = new Blob([JSON.stringify(task, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `研究任务-${task.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
