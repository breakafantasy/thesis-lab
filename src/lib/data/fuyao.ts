// 扶摇数据源（同花顺官方 A 股金融数据服务 https://fuyao.aicubes.cn/docs/）
// 认证：Header `X-api-key`；成功 = HTTP 200 且 body.code === 0（code=4001 为限流）
// 接口契约快照见 docs/fuyao-api-docs.txt

import type { DataPoint } from "../types";
import { nowISO, type DataProvider, type ProviderQuery, type ProviderResult } from "./provider";

const base = () => (process.env.FUYAO_BASE_URL || "").replace(/\/+$/, "");
const key = () => process.env.FUYAO_API_KEY || "";

type Mapper = (p: Record<string, string>) => { path: string; query: Record<string, string> };

/** "2024-12-31" / "2024-4" → 报告期格式 "2024-4"（1 一季报 / 2 中报 / 3 三季报 / 4 年报） */
function toReport(period: string): string {
  const m = period.trim().match(/^(\d{4})-?(\d{1,2})/);
  if (!m) return period.trim();
  const q = String(Math.ceil(parseInt(m[2], 10) / 3));
  return `${m[1]}-${q}`;
}

/** "20241121" / "2024-11-21" → 毫秒时间戳（东八区当天 0 点） */
function toMs(date?: string): string {
  if (!date) return "";
  const m = (date ?? "").trim().match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!m) return "";
  return String(new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`).getTime());
}

const ENDPOINTS: Record<string, Mapper> = {
  quote: (p) => ({ path: "/api/a-share/prices/snapshot", query: { thscodes: p.codes || "" } }),
  kline: (p) => ({
    path: "/api/a-share/prices/historical",
    query: {
      thscode: (p.codes || "").split(",")[0],
      interval: "1d",
      start: toMs(p.start_date),
      end: toMs(p.end_date),
      adjust: "forward",
    },
  }),
  financial: (p) => ({
    path: "/api/a-share/financials/income-statements",
    query: {
      thscode: p.codes || "",
      period: p.period || "annual",
      // 强制至少 4 期，保证跨年度对比所需基准期齐全（LLM 可能误写 limit=2）
      limit: String(Math.max(4, parseInt(p.limit || "4", 10) || 4)),
    },
  }),
  indicator: (p) => ({
    path: "/api/a-share/financials/indicators",
    query: { thscode: p.codes || "", report: toReport(p.report || (p.periods || "").split(",")[0]) },
  }),
  valuation: (p) => ({ path: "/api/a-share/valuations/snapshot", query: { thscodes: p.codes || "" } }),
  index: (p) => ({ path: "/api/a-share-index/prices/snapshot", query: { thscodes: p.codes || "" } }),
  sector: (p) => ({ path: "/api/a-share-index/constituents/ths-index-list-by-stock", query: { thscode: p.codes || "" } }),
  search: (p) => ({ path: "/api/meta/tickers/search", query: { q: p.q || "", asset_type: "a-share" } }),
};

/** 数值型字符串（扶摇指标接口的 value 为字符串，如 "43.82138500"） */
function isNumericString(v: unknown): v is string {
  return typeof v === "string" && /^-?\d+(\.\d+)?%?$/.test(v.trim());
}

/** 从扶摇返回结构中宽容提取数据点：携带报告期上下文（report_date/period 字段） */
function extractPoints(kind: string, json: unknown): DataPoint[] {
  const points: DataPoint[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: number | string, period?: string, unit?: string) => {
    const keyText = `${label}|${period ?? ""}|${String(value)}`;
    if (seen.has(keyText)) return;
    seen.add(keyText);
    points.push({ label, value, period, unit });
  };
  const walk = (node: unknown, labelPrefix: string, periodCtx?: string) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, labelPrefix, periodCtx);
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // 优先 fiscal_year（利润表/资产负债表/现金流量表用），其次 report_date/report/period
      const ctx =
        (obj.fiscal_year != null ? String(obj.fiscal_year) : undefined) ??
        (obj.report_date as string) ??
        (obj.report as string) ??
        (obj.period as string) ??
        periodCtx;
      // 标准形 { label/name/field/index_id, value }
      if ("value" in obj && ("label" in obj || "name" in obj || "field" in obj || "index_id" in obj)) {
        const v = obj.value;
        if (typeof v === "number" || isNumericString(v)) {
          push(String(obj.label ?? obj.name ?? obj.field ?? obj.index_id ?? labelPrefix), v, ctx, obj.unit as string | undefined);
          return;
        }
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === "raw" || k === "status" || k === "code" || k === "message" || k === "request_id" || k === "timestamp" || k === "total") continue;
        if (typeof v === "number" || isNumericString(v)) push(labelPrefix ? `${labelPrefix}.${k}` : k, v, ctx);
        else if (typeof v === "object") walk(v, labelPrefix ? `${labelPrefix}.${k}` : k, ctx);
      }
    }
  };
  const anyObj = json as { points?: unknown[]; data?: unknown; item?: unknown[] } | null;
  if (anyObj?.points) walk(anyObj.points, "", undefined);
  else if (anyObj?.item) walk(anyObj.item, "", undefined);
  else if (anyObj?.data) walk(anyObj.data, "", undefined);
  else walk(json, "", undefined);
  // 利润表 4 年 × 20+ 字段 ≈ 80+ 数据点，上限放宽以避免截断早年数据
  return points.slice(0, 120);
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
    if (k) headers["X-api-key"] = k;
    let json: Record<string, unknown> | null = null;
    // 限流（code=4001）时退避重试一次
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        return { status: "error", statusNote: `扶摇接口 HTTP ${res.status}`, points: [], materials: [], fetchedAt: nowISO() };
      }
      json = await res.json().catch(() => null);
      if (!json) {
        return { status: "error", statusNote: "扶摇返回无法解析", points: [], materials: [], fetchedAt: nowISO() };
      }
      if (json.code === 4001 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000)); // 限流退避
        continue;
      }
      break;
    }
    if (!json) {
      return { status: "error", statusNote: "扶摇返回无法解析", points: [], materials: [], fetchedAt: nowISO() };
    }
    if (json.code !== 0) {
      const note =
        json.code === 4001 ? `扶摇接口限流（code=4001）：${json.message ?? ""}` : `扶摇接口 code=${json.code}：${json.message ?? "未知错误"}`;
      return { status: "error", statusNote: note, points: [], materials: [], raw: json, fetchedAt: nowISO() };
    }
    const points = extractPoints(q.kind, json.data);
    if (points.length === 0) {
      return { status: "empty", statusNote: "扶摇返回数据为空", points, materials: [], raw: json, fetchedAt: nowISO() };
    }
    return { status: "ok", points, materials: [], raw: json, fetchedAt: nowISO() };
  },
};
