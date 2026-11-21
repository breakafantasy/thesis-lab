// 数据提供者统一接口：扶摇（行情/财务）、iFinD MCP（公告/研报/行业）、内置快照（演示/测试/降级兜底）

import type { DataPoint, DataSourceId, MaterialRef } from "../types";

export interface ProviderQuery {
  kind: string;
  params: Record<string, string>;
}

export interface ProviderResult {
  status: "ok" | "degraded" | "error" | "empty";
  statusNote?: string;
  points: DataPoint[];
  materials: MaterialRef[];
  raw?: unknown;
  fetchedAt: string;
}

export interface DataProvider {
  id: DataSourceId;
  /** 凭证是否配置齐全（未配置时调用方应跳过） */
  available(): boolean;
  /** 执行查询；接口失败应返回 status=error 或抛错，由调用方降级 */
  fetch(q: ProviderQuery): Promise<ProviderResult>;
}

export const nowISO = () => new Date().toISOString();

/** 给 provider 调用加超时保护：超时返回 status=error，不抛错 */
export async function withTimeout(p: Promise<ProviderResult>, ms: number, source: string): Promise<ProviderResult> {
  try {
    return await Promise.race([
      p,
      new Promise<ProviderResult>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), ms)
      ),
    ]);
  } catch (e) {
    const msg = e instanceof Error && e.message === "timeout" ? "请求超时" : `请求失败：${(e as Error).message}`;
    return { status: "error", statusNote: `${source} ${msg}`, points: [], materials: [], fetchedAt: nowISO() };
  }
}
