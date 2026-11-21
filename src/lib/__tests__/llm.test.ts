import { describe, expect, it } from "vitest";
import { extractJSON } from "@/lib/llm";
import { findForeignNumbers, numbersIn, sanitizeNumbers } from "@/lib/pipeline/decompose";

describe("extractJSON", () => {
  it("解析纯 JSON", () => {
    const r = extractJSON('{"a": 1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  it("解析带 markdown 围栏的 JSON", () => {
    const r = extractJSON('```json\n{"a": [1, 2]}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: [1, 2] });
  });

  it("解析前后有杂文说明的 JSON", () => {
    const r = extractJSON('好的，以下是结果：\n{"b": "x"}\n以上。');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ b: "x" });
  });

  it("无法解析时返回错误", () => {
    const r = extractJSON("完全没有 JSON");
    expect(r.ok).toBe(false);
  });
});

describe("防伪造数值扫描", () => {
  it("提取文本中的数字", () => {
    expect(numbersIn("增速 12.5% 与 3 亿、42 亿元")).toEqual(["12.5%", "3", "42"]);
  });

  it("sanitizeNumbers 只替换载荷之外的数字", () => {
    const known = new Set(["42"]);
    const { text, stripped } = sanitizeNumbers("净利润 9999 万元，占比 42%", known);
    expect(stripped).toEqual(["9999"]);
    expect(text).toContain("见载荷");
    expect(text).toContain("42%");
  });

  it("findForeignNumbers 识别载荷外数字", () => {
    const known = new Set(["320", "210", "2024"]);
    expect(findForeignNumbers("2024 年净利润 320，同比大增 55%", known)).toEqual(["55%"]);
  });
});
