// iFinD MCP 客户端：公告/研报/行业及公司数据
// 通过 MCP Streamable HTTP（JSON-RPC 2.0）调用远程 MCP 服务；
// 工具名按关键词匹配（公告/研报/行业/公司），不依赖具体命名。

import type { DataPoint, MaterialRef, ProviderQuery, ProviderResult } from "../types";
import { nowISO, type DataProvider } from "./provider";

const mcpUrl = () => (process.env.IFIND_MCP_URL || "").trim();
const token = () => process.env.IFIND_MCP_TOKEN || "";

interface ToolInfo {
  name: string;
  description: string;
}

// 查询类型 → 工具名/描述关键词（匹配任一即视为可用）
const KIND_HINTS: Record<string, string[]> = {
  announcements: ["公告", "披露", "announcement", "巨潮"],
  research: ["研报", "研究报告", "research", "report"],
  industry: ["行业", "industry"],
  company: ["公司", "company", "资料", "profile"],
};

let sessionId: string | null = null;
let toolsCache: ToolInfo[] | null = null;

/** JSON-RPC 调用；兼容单行 JSON 与 SSE（text/event-stream）两种响应 */
async function rpc(method: string, params: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const tk = token();
  if (tk) headers.Authorization = `Bearer ${tk}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(mcpUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const sid = res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id");
  if (sid) sessionId = sid;
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  const text = await res.text();
  let payload: { result?: unknown; error?: { message?: string } } | null = null;
  if (text.trim().startsWith("data:")) {
    // SSE：取最后一条有内容的消息
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

async function ensureTools(): Promise<ToolInfo[]> {
  if (toolsCache) return toolsCache;
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "thesis-lab", version: "0.1.0" },
  });
  const result = (await rpc("tools/list", {})) as { tools?: ToolInfo[] };
  toolsCache = result.tools ?? [];
  return toolsCache;
}

function matchTool(kind: string, tools: ToolInfo[]): ToolInfo | null {
  const hints = KIND_HINTS[kind] ?? [];
  const haystack = (t: ToolInfo) => `${t.name} ${t.description}`.toLowerCase();
  for (const hint of hints) {
    const found = tools.find((t) => haystack(t).includes(hint.toLowerCase()));
    if (found) return found;
  }
  // 兜底：名字里含「搜索/search/query」的工具
  return tools.find((t) => /搜索|search|query|检索/.test(haystack(t))) ?? null;
}

/** 从工具返回文本中提取材料引用 */
function extractMaterials(kind: string, text: string): MaterialRef[] {
  const typeMap: Record<string, MaterialRef["type"]> = {
    announcements: "announcement",
    research: "research",
    industry: "other",
    company: "other",
  };
  const title =
    (text.match(/^(?:标题|title)[：:]\s*(.+)$/im)?.[1] ??
      text.split("\n").find((l) => l.trim().length > 4 && l.trim().length < 80) ??
      `${kind} 查询结果`)?.trim() ?? `${kind} 查询结果`;
  return [
    {
      type: typeMap[kind] ?? "other",
      title: title.slice(0, 120),
      source: "iFinD",
      quote: text.slice(0, 500),
    },
  ];
}

export const ifindProvider: DataProvider = {
  id: "ifind",
  available: () => mcpUrl().length > 0,
  async fetch(q: ProviderQuery): Promise<ProviderResult> {
    if (!KIND_HINTS[q.kind]) {
      return { status: "empty", statusNote: `iFinD 不支持查询类型：${q.kind}`, points: [], materials: [], fetchedAt: nowISO() };
    }
    const tools = await ensureTools();
    const tool = matchTool(q.kind, tools);
    if (!tool) {
      return { status: "empty", statusNote: `iFinD 未找到可用的「${q.kind}」类工具`, points: [], materials: [], fetchedAt: nowISO() };
    }
    const result = (await rpc("tools/call", { name: tool.name, arguments: q.params })) as {
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
    const points: DataPoint[] = [];
    const materials = extractMaterials(q.kind, text);
    return { status: "ok", points, materials, raw: { tool: tool.name, result }, fetchedAt: nowISO() };
  },
};
