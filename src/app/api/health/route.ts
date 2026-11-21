// GET /api/health —— 数据源与 LLM 配置状态（用于演示/测试/部署自检）

import { llmConfigured } from "@/lib/llm";
import { fuyaoProvider } from "@/lib/data/fuyao";
import { ifindProvider } from "@/lib/data/ifind";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    llm: llmConfigured(),
    fuyao: fuyaoProvider.available(),
    ifind: ifindProvider.available(),
    snapshot: true,
  });
}
