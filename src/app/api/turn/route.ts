import { NextResponse } from "next/server";
import { runMockTurn } from "@/lib/mockInference";
import { validateTurnRequest, ValidationError } from "@/lib/validate";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: Request) {
  const limit = checkRateLimit(clientKey(req));
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(limit.retryAfterMs / 1000).toString() },
      }
    );
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "payload too large" }, { status: 413 });
    }
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = validateTurnRequest(raw);
  } catch (e) {
    const message = e instanceof ValidationError ? e.message : "invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let result;
  try {
    result = runMockTurn(parsed);
  } catch {
    return NextResponse.json({ error: "inference failed" }, { status: 500 });
  }
  await new Promise((r) => setTimeout(r, 350 + Math.random() * 400));
  return NextResponse.json(result);
}
