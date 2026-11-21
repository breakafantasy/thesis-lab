// POST /api/followup —— 对已完成验证任务的追问
// 请求体：{ task: VerificationTask, question: string }

import { NextRequest } from "next/server";
import { answerFollowup } from "@/lib/pipeline/followup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const task = body?.task;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!task || !question) {
    return Response.json({ error: "缺少研究任务或追问内容" }, { status: 400 });
  }
  try {
    const result = await answerFollowup(task, question);
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "追问失败" },
      { status: 502 }
    );
  }
}
