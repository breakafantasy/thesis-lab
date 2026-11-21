// 扶摇数据源：A股行情快照/历史K线、财务报表与指标、估值、指数/板块
// REST 端点映射集中在 ENDPOINTS 表中，拿到官方文档后只需调整此表与 extractPoints。

import type { DataPoint, DataProvider, ProviderQuery, ProviderResult } from "./provider";
import { nowISO } from "./provider";

const base = () => (process.env.FUYAO_BASE_URL || "").replace(/\/+$/, "");
const key = () => process.env.FUYAO_API_KEY || "";

type Mapper = (p: Record<string, string>) => { path: string; query: Record<string, string> };

const ENDPOINTS: Record<string, Mapper> = {
  quote: (p) => ({ path: "/quote", query: { codes: p.codes || "" } }),
  kline: (p) => ({ path: "/kline", query: { codes: p.codes || "", start_date: p.start_date || "", end_date: p.end_date || "" } }),
  financial: (p) => ({ path: "/financial", query: { codes: p.codes || "", periods: p.periods || "", fields: p.fields || "" } }),
  indicator: (p) => ({ path: "/indicator", query: { codes: p.codes || "", periods: p.periods || "", fields: p.fields || "" } }),
  valuation: (p) => ({ path: "/valuation", query: { codes: p.codes || "", periods: p.periods || "" } }),
  index: (p) => ({ path: "/index", query: { codes: p.codes || "" } }),
  sector: (p) => ({ path: "/sector", query: { codes: p.codes || "" } }),
};

/** 从接口返回中宽容地提取数据点（适配多种返回形状，具体按扶摇文档调整） */
function extractPoints(kind: string, json: unknown): DataPoint[] {
  const points: DataPoint[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: number | string, period?: string, unit?: string) => {
    const key = `${label}|${period ?? ""}|${String(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push({ label, value, period, unit });
  };
  const walk = (node: unknown, labelPrefix = "") => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, labelPrefix));
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // 标准形 { label, value, period }
      if ("value" in obj && ("label" in obj || "name" in obj || "field" in obj)) {
        const v = obj.value;
        if (typeof v === "number" || typeof v === "string") {
          push(String(obj.label ?? obj.name ?? obj.field ?? labelPrefix), v, obj.period as string | undefined, obj.unit as string | undefined);
          return;
        }
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === "raw" || k === "status" || k === "code" || k === "message") continue;
        if (typeof v === "number" && (k === "value" || labelPrefix)) push(labelPrefix ? `${labelPrefix}.${k}` : k, v);
        else if (typeof v === "object") walk(v, labelPrefix ? `${labelPrefix}.${k}` : k);
      }
    }
  };
  // 优先识别 points/data 数组
  const anyObj = json as { points?: unknown[]; data?: unknown } | null;
  if (anyObj?.points) walk(anyObj.points);
  else if (anyObj?.data) walk(anyObj.data);
  else walk(json);
  return points.slice(0, 40);
}

export const fuyaoProvider: DataProvider = {
  id: "fuyao",
  available: () => base().length > 0,
  async fetch(q: ProviderQuery): Promise<ProviderResult> {
    const mapper = ENDPOINTS[q.kind];
    if (!mapper) {
      return { status: "empty", statusNote: `扶摇不支持查询类型：${q.kind}`, points: [], materials: [], fetchedAt: nowISO() };
    }
    const { path, query } = mapper(q.params);
    const url = new URL(base() + path);
    for (const [k, v] of Object.entries(query)) if (v) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Accept: "application/json" };
    const k = key();
    if (k) headers.Authorization = `Bearer ${k}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return { status: "error", statusNote: `扶摇接口 HTTP ${res.status}`, points: [], materials: [], fetchedAt: nowISO() };
    }
    const json = await res.json();
    const points = extractPoints(q.kind, json);
    if (points.length === 0) {
      return { status: "empty", statusNote: "扶摇返回数据为空", points, materials: [], raw: json, fetchedAt: nowISO() };
    }
    return { status: "ok", points, materials: [], raw: json, fetchedAt: nowISO() };
  },
};
