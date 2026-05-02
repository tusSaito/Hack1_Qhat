import { NextResponse } from "next/server";
import { runMockTurn } from "@/lib/mockInference";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const result = runMockTurn({
    userText: body.user_text ?? "",
    prevEmotion: body.prev_emotion,
    characterId: body.character_id,
    redoCount: body.redo_count ?? 0,
    proactive: body.proactive,
    expand: body.expand,
  });
  // Simulate inference latency a bit so the "thinking" UI is visible
  await new Promise((r) => setTimeout(r, 350 + Math.random() * 400));
  return NextResponse.json(result);
}
