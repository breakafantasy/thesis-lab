// iFinD MCP 客户端：公告/研报/行业及公司数据
// MCP StreamableHTTP + JSON-RPC 2.0；IFIND_MCP_URL 支持逗号分隔多个端点
// （如 stock-mcp 与 news-mcp），工具按关键词跨端点匹配，不依赖具体命名。

import type { DataPoint, MaterialRef } from "../types";
import { nowISO, type DataProvider, type ProviderQuery, type ProviderResult } from "./provider";

const urls = () =>
  (process.env.IFIND_MCP_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const token = () => process.env.IFIND_MCP_TOKEN || "";

interface ToolInfo {
  name: string;
  description: string;
}

// 查询类型 → 工具名/描述关键词（匹配任一即视为可用）
// 实测工具：stock-mcp（get_stock_events 披露事件/get_stock_financials 财务等 10 个）；news-mcp（search_notice 公告/search_news 新闻/search_trending_news）
const KIND_HINTS: Record<string, string[]> = {
  announcements: ["公告", "notice"],
  research: ["研报", "研究报告", "research", "新闻", "news", "资讯"],
  industry: ["行业", "industry", "板块"],
  company: ["公司", "资料", "profile", "主营业务"],
};

/** 结构化参数 → iFinD 工具调用参数（自然语言 query + 时间范围） */
function buildArguments(kind: string, params: Record<string, string>): Record<string, unknown> {
  // 自然拼接而非「标的：」标签式（标签前缀会干扰 iFinD 的语义检索）
  const query = [params.codes, params.keyword].filter((s) => s && s.trim()).join(" ") || params.q || " ";
  const args: Record<string, unknown> = { query };
  if (kind === "announcements" || kind === "research") {
    args.time_start = params.start_date || "2020-01-01";
    args.time_end = params.end_date || new Date().toISOString().slice(0, 10);
  }
  return args;
}

/** 判断查询是否实际无结果（iFinD 无命中时返回「未找到」提示而非报错） */
function isEmptyResult(text: string): boolean {
  return /dataTotalVolume["']?\s*[:：]\s*0|未找到符合要求的证券|查询无结果|暂无数据|无相关公告/i.test(text);
}

// 每个端点的会话与工具缓存
const servers = new Map<string, { sessionId: string | null; tools: ToolInfo[] | null }>();

async function rpc(url: string, method: string, params: unknown): Promise<unknown> {
  const server = servers.get(url) ?? { sessionId: null, tools: null };
  servers.set(url, server);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const tk = token();
  if (tk) headers.Authorization = `Bearer ${tk}`;
  if (server.sessionId) headers["Mcp-Session-Id"] = server.sessionId;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const sid = res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id");
  if (sid) server.sessionId = sid;
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}（${url}）`);
  const text = await res.text();
  let payload: { result?: unknown; error?: { message?: string } } | null = null;
  if (text.trim().startsWith("data:")) {
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.startsWith("data:")) {
        try {
          payload = JSON.parse(t.slice(5).trim());
        } catch {
          /* 忽略非 JSON 事件 */
        }
      }
    }
  } else {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!payload) throw new Error("MCP 返回无法解析");
  if (payload.error) throw new Error(`MCP 错误：${payload.error.message ?? "未知"}`);
  return payload.result;
}

async function ensureTools(url: string): Promise<ToolInfo[]> {
  const server = servers.get(url) ?? { sessionId: null, tools: null };
  if (server.tools) return server.tools;
  await rpc(url, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "thesis-lab", version: "0.1.0" },
  });
  const result = (await rpc(url, "tools/list", {})) as { tools?: ToolInfo[] };
  server.tools = result.tools ?? [];
  servers.set(url, server);
  return server.tools;
}

/** 跨端点匹配工具，返回 { url, tool } */
async function matchTool(kind: string): Promise<{ url: string; tool: ToolInfo } | null> {
  const hints = KIND_HINTS[kind] ?? [];
  const haystack = (t: ToolInfo) => `${t.name} ${t.description}`.toLowerCase();
  for (const url of urls()) {
    let tools: ToolInfo[];
    try {
      tools = await ensureTools(url);
    } catch {
      continue; // 该端点不可用，试下一个
    }
    for (const hint of hints) {
      const found = tools.find((t) => haystack(t).includes(hint.toLowerCase()));
      if (found) return { url, tool: found };
    }
    const fallback = tools.find((t) => /搜索|search|query|检索/.test(haystack(t)));
    if (fallback) return { url, tool: fallback };
  }
  return null;
}

/** 从工具返回文本中提取材料引用（兼容 search_notice 的包装 JSON 与纯文本两种形态） */
function extractMaterials(kind: string, text: string): MaterialRef[] {
  const typeMap: Record<string, MaterialRef["type"]> = {
    announcements: "announcement",
    research: "research",
    industry: "other",
    company: "other",
  };
  const type = typeMap[kind] ?? "other";
  // search_notice 返回包装 JSON：{code,msg,data:"[{公告标题,公告片段内容,日期},...]"}
  try {
    const wrapped = JSON.parse(text) as { data?: unknown };
    if (wrapped?.data && typeof wrapped.data === "string") {
      const arr = JSON.parse(wrapped.data) as { 公告标题?: string; title?: string; 公告片段内容?: string; content?: string; 日期?: string; date?: string }[];
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.slice(0, 5).map((x) => ({
          type,
          title: String(x.公告标题 ?? x.title ?? "公告").slice(0, 120),
          source: "iFinD",
          date: String(x.日期 ?? x.date ?? ""),
          quote: String(x.公告片段内容 ?? x.content ?? "").slice(0, 600),
        }));
      }
    }
  } catch {
    /* 非 JSON，走纯文本兜底 */
  }
  const title =
    (text.match(/^(?:标题|title)[：:]\s*(.+)$/im)?.[1] ??
      text.split("\n").find((l) => l.trim().length > 4 && l.trim().length < 80) ??
      `${kind} 查询结果`)?.trim() ?? `${kind} 查询结果`;
  return [{ type, title: title.slice(0, 120), source: "iFinD", quote: text.slice(0, 600) }];
}

export const ifindProvider: DataProvider = {
  id: "ifind",
  available: () => urls().length > 0,
  async fetch(q: ProviderQuery): Promise<ProviderResult> {
    if (!KIND_HINTS[q.kind]) {
      return { status: "empty", statusNote: `iFinD 不支持查询类型：${q.kind}`, points: [], materials: [], fetchedAt: nowISO() };
    }
    const matched = await matchTool(q.kind);
    if (!matched) {
      return { status: "empty", statusNote: `iFinD 未找到可用的「${q.kind}」类工具`, points: [], materials: [], fetchedAt: nowISO() };
    }
    const result = (await rpc(matched.url, "tools/call", { name: matched.tool.name, arguments: buildArguments(q.kind, q.params) })) as {
      content?: { type: string; text?: string }[];
      structuredContent?: unknown;
    };
    const text = (result.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
    if (!text.trim()) {
      return { status: "empty", statusNote: "iFinD 查询无结果", points: [], materials: [], raw: result, fetchedAt: nowISO() };
    }
    if (isEmptyResult(text)) {
      return { status: "empty", statusNote: "iFinD 未检索到符合条件的公告/材料", points: [], materials: [], raw: result, fetchedAt: nowISO() };
    }
    const points: DataPoint[] = [];
    const materials = extractMaterials(q.kind, text);
    return { status: "ok", points, materials, raw: { tool: matched.tool.name, result }, fetchedAt: nowISO() };
  },
};
