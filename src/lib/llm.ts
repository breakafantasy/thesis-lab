// DeepSeek（OpenAI 兼容）LLM 封装
// - chatJSON：结构化输出（JSON mode）+ 解析失败自动修复重试
// - chatText：追问等自由文本
// - __setChatOverride：测试注入 mock

export class LLMError extends Error {}

const BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const KEY = process.env.DEEPSEEK_API_KEY || "";
const MODEL = "deepseek-chat";

export function llmConfigured(): boolean {
  return KEY.length > 0;
}

type ChatOverride = (messages: { role: string; content: string }[], temperature?: number) => Promise<string>;
let override: ChatOverride | null = null;
/** 仅供测试注入 */
export function __setChatOverride(fn: ChatOverride | null) {
  override = fn;
}

async function callChat(messages: { role: string; content: string }[], temperature: number): Promise<string> {
  if (override) return override(messages, temperature);
  if (!llmConfigured()) throw new LLMError("未配置 DEEPSEEK_API_KEY");
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LLMError(`LLM 接口错误 ${res.status}：${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new LLMError("LLM 返回空内容");
  return content;
}

/** 宽松提取 JSON：去除 markdown 代码块围栏，截取首尾大括号 */
export function extractJSON(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, error: "输出中未找到 JSON 对象" };
  try {
    return { ok: true, value: JSON.parse(t.slice(start, end + 1)) };
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${(e as Error).message}` };
  }
}

export interface ChatJSONOptions {
  system: string;
  user: string;
  temperature?: number;
  maxRetries?: number;
  /** 返回错误信息（非空字符串）表示结构不合规，将带着修复提示重试 */
  validate?: (v: unknown) => string | null;
}

export async function chatJSON<T>(opts: ChatJSONOptions): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  let repairHint = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const user = repairHint ? `${opts.user}\n\n【上一次输出不合规，请修复后重新输出】\n${repairHint}` : opts.user;
    const content = await callChat(
      [
        { role: "system", content: opts.system },
        { role: "user", content: user },
      ],
      opts.temperature ?? 0.2
    );
    const parsed = extractJSON(content);
    if (!parsed.ok) {
      repairHint = parsed.error + "。请只输出一个合法 JSON 对象，不要输出任何其他文字。";
      continue;
    }
    if (opts.validate) {
      const err = opts.validate(parsed.value);
      if (err) {
        repairHint = err + "。请按上述要求修复 JSON 内容后重新输出。";
        continue;
      }
    }
    return parsed.value as T;
  }
  throw new LLMError(`LLM 连续 ${maxRetries} 次输出不合规，已放弃。`);
}

export async function chatText(system: string, user: string, temperature = 0.4): Promise<string> {
  const content = await callChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature
  );
  // 允许模型在自由文本中包一层 JSON（追问接口需要结构化返回，此处由调用方处理）
  return content;
}

/** 通用结构校验辅助 */
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
