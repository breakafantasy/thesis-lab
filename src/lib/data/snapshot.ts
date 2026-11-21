// 内置数据快照：真实公开数据（财报/公告，标注报告期与出处），用于演示、测试与降级兜底。
// 数据文件：src/lib/data/snapshot-data/dataset.json
// 该数据源的目的：无凭证/接口故障时保证主链路可跑通；所有证据会如实标注来源为「内置快照」。

import dataset from "./snapshot-data/dataset.json";
import type { DataPoint, MaterialRef } from "../types";
import { nowISO, type DataProvider, type ProviderQuery, type ProviderResult } from "./provider";

export interface SnapshotEntry {
  source: "fuyao" | "ifind";
  kind: string;
  matchKey: string; // 用 params 的哪个字段匹配（如 codes）
  matchValue: string; // 包含该值即命中（如 600418.SH）
  points: DataPoint[];
  materials: MaterialRef[];
  note: string; // 出处与报告期说明
}

const entries = (dataset as { entries: SnapshotEntry[] }).entries;

function findEntry(q: ProviderQuery): SnapshotEntry | null {
  const needSource =
    q.kind === "announcements" || q.kind === "research" || q.kind === "industry" || q.kind === "company"
      ? "ifind"
      : "fuyao";
  for (const e of entries) {
    if (e.source !== needSource || e.kind !== q.kind) continue;
    const param = q.params[e.matchKey] ?? "";
    if (param.length > 0 && e.matchValue.length > 0 && (param.includes(e.matchValue) || e.matchValue.includes(param))) {
      return e;
    }
  }
  return null;
}

export const snapshotProvider: DataProvider = {
  id: "snapshot",
  available: () => true,
  async fetch(q: ProviderQuery): Promise<ProviderResult> {
    const entry = findEntry(q);
    if (!entry) {
      return {
        status: "empty",
        statusNote: "内置快照中无该查询的数据（快照仅覆盖演示案例与测试标的）",
        points: [],
        materials: [],
        fetchedAt: nowISO(),
      };
    }
    return {
      status: "ok",
      statusNote: entry.note,
      points: entry.points,
      materials: entry.materials,
      raw: undefined,
      fetchedAt: nowISO(),
    };
  },
};
