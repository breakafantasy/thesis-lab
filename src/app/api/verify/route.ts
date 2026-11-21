// POST /api/verify —— 主链路（SSE 流式返回管线事件）
// 请求体：{ thesis: string, clarifications?: {questionId,question,answer}[], faultDemo?: boolean }
// 澄清阶段：返回 clarify 事件后中断；客户端携带 clarifications 重新调用即继续。

import { NextRequest } from "next/server";
import { runVerification } from "@/lib/pipeline";
import type { PipelineEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sse(stream: ReadableStream) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const thesisText = typeof body?.thesis === "string" ? body.thesis.trim() : "";
  if (!thesisText) {
    return Response.json({ error: "缺少命题文本" }, { status: 400 });
  }
  const clarifications = Array.isArray(body?.clarifications) ? body.clarifications : [];
  const faultDemo = body?.faultDemo === true;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: PipelineEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      try {
        await runVerification({ thesisText, clarifications, faultDemo }, emit);
      } catch {
        // 管线内部已通过 error 事件报告具体阶段与原因，这里只负责结束流
      } finally {
        controller.close();
      }
    },
    cancel() {
      // 客户端断开：流自然终止（无额外清理）
    },
  });
  return sse(stream);
}
