// 共享 UI 小组件：stance 徽章、置信度条、证据引用文本渲染

"use client";

import type { EvidenceStance, VerdictLevel } from "@/lib/types";
import { STANCE_LABEL, VERDICT_LABEL } from "@/lib/types";

const stanceClass: Record<EvidenceStance, string> = {
  support: "badge-support",
  oppose: "badge-oppose",
  unverifiable: "badge-unverifiable",
  partial: "badge-partial",
};

export function StanceBadge({ stance }: { stance: EvidenceStance }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${stanceClass[stance]}`}>
      {STANCE_LABEL[stance]}
    </span>
  );
}

const verdictClass: Record<VerdictLevel, string> = {
  support: "badge-support",
  partial_support: "badge-partial",
  unsupported: "badge-oppose",
  undetermined: "badge-unverifiable",
};

export function VerdictBadge({ level }: { level: VerdictLevel }) {
  return (
    <span className={`badge-verdict inline-flex items-center rounded-md px-2.5 py-1 text-sm ${verdictClass[level]}`}>
      {VERDICT_LABEL[level]}
    </span>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 66 ? "#16a34a" : pct >= 33 ? "#d97706" : "#dc2626";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-gray-200">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs text-gray-500">{pct}%</span>
    </div>
  );
}

/** 把文本中的 [EV-xxx] 引用渲染为可点击跳转的标签 */
export function EvidenceRefText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        const m = part.match(/^\[([^\]]+)\]$/);
        if (m) {
          return (
            <button
              key={i}
              onClick={() => {
                const el = document.getElementById(`ev-${m[1]}`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  el.classList.add("ring-2", "ring-blue-400");
                  setTimeout(() => el.classList.remove("ring-2", "ring-blue-400"), 1600);
                }
              }}
              className="mx-0.5 inline rounded bg-blue-50 px-1 font-mono text-xs text-blue-600 hover:bg-blue-100"
            >
              {m[1]}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
