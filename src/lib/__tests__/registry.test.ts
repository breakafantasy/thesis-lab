import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchData } from "@/lib/data/registry";
import type { DataNeed } from "@/lib/types";

const NEED_INDICATOR: DataNeed = {
  source: "fuyao",
  kind: "indicator",
  params: { codes: "000000.SZ", periods: "2024-12-31,2023-12-31", fields: "revenue" },
  queryDescription: "测试查询",
};

beforeEach(() => {
  delete process.env.FUYAO_BASE_URL;
  delete process.env.IFIND_MCP_URL;
});

afterEach(() => {
  delete process.env.FUYAO_BASE_URL;
  delete process.env.IFIND_MCP_URL;
});

describe("数据路由与降级", () => {
  it("真实源未配置时降级到内置快照并标注来源", async () => {
    const p = await fetchData(NEED_INDICATOR, "SQ-T1");
    expect(p.source).toBe("snapshot");
    expect(p.requestedSource).toBe("fuyao");
    expect(p.status).toBe("degraded");
    expect(p.statusNote).toContain("降级");
    expect(p.points.length).toBeGreaterThan(0);
  });

  it("快照无数据时如实返回 empty（不编造）", async () => {
    const p = await fetchData(
      { ...NEED_INDICATOR, params: { ...NEED_INDICATOR.params, codes: "999999.SZ" } },
      "SQ-T2"
    );
    expect(p.status).toBe("empty");
    expect(p.points.length).toBe(0);
  });

  it("故障演示模式模拟真实源异常并降级", async () => {
    process.env.FUYAO_BASE_URL = "http://127.0.0.1:9"; // 不可达地址，仅使 provider 判定为可用
    const p = await fetchData(NEED_INDICATOR, "SQ-T3", { faultDemo: true });
    expect(p.source).toBe("snapshot");
    expect(p.statusNote).toContain("模拟故障");
  });

  it("iFinD 公告查询在快照中命中测试材料", async () => {
    const p = await fetchData(
      { source: "ifind", kind: "announcements", params: { codes: "000000.SZ", keyword: "测试股份" }, queryDescription: "公告" },
      "SQ-T4"
    );
    expect(p.status).toBe("degraded"); // ifind 未配置 → 降级快照
    expect(p.materials.length).toBe(1);
    expect(p.materials[0].title).toContain("测试股份");
  });
});
