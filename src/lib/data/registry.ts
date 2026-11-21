// 数据路由与降级：按 DataNeed 选择 provider，失败自动降级到快照；
// 所有降级/异常都会写进 DataPayload，供证据组织与结论置信度使用。

import type { DataNeed, DataPayload, DataSourceId } from "../types";
import { fuyaoProvider } from "./fuyao";
import { ifindProvider } from "./ifind";
import { snapshotProvider } from "./snapshot";
import { withTimeout, type DataProvider, type ProviderQuery, type ProviderResult } from "./provider";

export interface FetchOptions {
  /** 故障演示模式：模拟真实数据源故障（走降级链路） */
  faultDemo?: boolean;
  timeoutMs?: number;
}

function chainFor(source: DataSourceId): DataProvider[] {
  if (source === "fuyao") return [fuyaoProvider, snapshotProvider];
  if (source === "ifind") return [ifindProvider, snapshotProvider];
  return [snapshotProvider];
}

const cache = new Map<string, { at: number; result: ProviderResult }>();
const CACHE_TTL = 5 * 60_000;

async function tryProvider(p: DataProvider, q: ProviderQuery, timeoutMs: number, faultDemo: boolean): Promise<ProviderResult | null> {
  if (!p.available()) return null;
  if (faultDemo && p.id !== "snapshot") {
    return {
      status: "error",
      statusNote: `模拟故障：${p.id} 数据源不可用（故障演示模式已开启）`,
      points: [],
      materials: [],
      fetchedAt: new Date().toISOString(),
    };
  }
  return withTimeout(p.fetch(q), timeoutMs, p.id);
}

export async function fetchData(need: DataNeed, subQuestionId: string, opts: FetchOptions = {}): Promise<DataPayload> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const q: ProviderQuery = { kind: need.kind, params: need.params };
  const cacheKey = JSON.stringify([need.source, q]);

  const hit = opts.faultDemo ? undefined : cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return buildPayload(need, subQuestionId, hit.result, need.source);
  }

  let result: ProviderResult | null = null;
  let used: DataSourceId = need.source;

  for (const p of chainFor(need.source)) {
    const r = await tryProvider(p, q, timeoutMs, !!opts.faultDemo);
    if (!r) continue; // 未配置，试下一个
    if (r.status === "ok" || r.status === "degraded" || r.status === "empty") {
      result = r;
      used = p.id;
      break;
    }
    // status=error：记录并降级到下一个 provider
    result = r;
  }

  if (!result) {
    result = {
      status: "error",
      statusNote: `数据源 ${need.source} 未配置或全部不可用`,
      points: [],
      materials: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  if (result.status === "ok" && used === need.source && !opts.faultDemo) {
    cache.set(cacheKey, { at: Date.now(), result });
  }
  return buildPayload(need, subQuestionId, result, used);
}

function buildPayload(need: DataNeed, subQuestionId: string, result: ProviderResult, used: DataSourceId): DataPayload {
  const degraded = used !== need.source && result.status === "ok";
  const status = degraded ? "degraded" : result.status;
  const statusNote =
    result.status === "ok" && used !== need.source
      ? `原数据源 ${need.source} 不可用，已降级至 ${used}${result.statusNote ? `（${result.statusNote}）` : ""}`
      : result.statusNote;
  return {
    id: `P-${crypto.randomUUID().slice(0, 8)}`,
    subQuestionId,
    source: used,
    requestedSource: need.source,
    status,
    statusNote,
    fetchedAt: result.fetchedAt,
    points: result.points,
    materials: result.materials,
    raw: result.raw,
  };
}
