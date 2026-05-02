// Gemini 2.5 Flash integration. Returns the same shape as runMockTurn so the
// /api/turn route can swap implementations transparently.
//
// Reads GEMINI_API_KEY from env. If missing, the helpers throw a typed error
// so the route can fall back to the mock without leaking 500s.

import type {
  Emotion,
  EmotionProbs,
  Message,
  TurnResponse,
} from "./types";
import { CHARACTERS } from "./characters";
import { dominant, entropy, normalize } from "./emotion";
import { SCENES } from "./scenes";

export class NoLLMKeyError extends Error {}
export class LLMCallError extends Error {}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description:
        "Natural Japanese reply, in character. 1-2 sentences max. Should sound spoken, not written.",
    },
    emotion: {
      type: "object",
      properties: {
        joy: { type: "number" },
        calm: { type: "number" },
        anxiety: { type: "number" },
        confusion: { type: "number" },
      },
      required: ["joy", "calm", "anxiety", "confusion"],
    },
    reaction: {
      type: "string",
      description:
        "Inner-thought bubble shown above the character's head. Very short Japanese phrase, 6-12 chars.",
    },
    reception: {
      type: "string",
      description:
        "How the user's last message landed, written from a third-person observer's perspective. 12-20 Japanese chars.",
    },
  },
  required: ["reply", "emotion", "reaction", "reception"],
};

interface LLMInput {
  userText: string;
  prevEmotion: EmotionProbs;
  characterId: string;
  redoCount: number;
  proactive?: boolean;
  expand?: boolean;
  history: Message[];
  sceneId: string;
}

function buildSystemPrompt(characterId: string, sceneId: string): string {
  const c = CHARACTERS[characterId];
  const scene = SCENES.find((s) => s.id === sceneId);
  const traits: Record<string, string> = {
    sakura:
      "21歳の大学生・咲良。映画とカフェ巡りが好き。少し人見知りだけど、話しかけられると嬉しい。一人称は「私」。語尾はやわらかく、敬語と砕けた口調が混ざる。",
    takahashi:
      "22歳の就活生・高橋。落ち着いた性格で同業界志望。一人称は「私」。丁寧めの口調、面接前で少し緊張している。",
    tanaka:
      "25歳の3つ上の先輩・田中。カジュアルな口調、タメ口寄り。気は使ってくれるけど、相手とは少しテンポが合わない。一人称は「俺」。",
  };

  return `あなたは ${c.name} になりきって日本語で会話します。

# 人物像
${traits[characterId] ?? c.name}

# シーン
${scene?.title ?? ""} — ${scene?.description ?? ""}

# あなたの役割
- 上の人物として、対人不安を抱える練習者と会話する。
- 1ターンの応答は1〜2文。話しすぎない。
- 練習者の言葉を **オウム返ししすぎない**。自然に受けて、返す。
- 相手が短い返事や沈黙でも、自然な間でこちらから話を広げて構わない。
- ユーザーが優しく接してきたら相手の不安は下がる。雑な返事や否定的な言葉なら不安・戸惑いが上がる。

# 出力（必ずJSONで）
- reply: 上の人物としての応答（短い日本語）
- emotion: 応答時点の人物の感情確率。{ joy, calm, anxiety, confusion } の合計を 1.0 にして。
- reaction: 心の中のひとこと（吹き出しに出る）。例: 「嬉しい！」「えっ、どういう意味…？」
- reception: 練習者の発話がどう届いたかの第三者目線の一文。例: 「少し安心したみたい」`;
}

function buildHistoryContents(
  history: Message[],
  characterName: string
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  // Translate our message log into Gemini's contents shape. The character is
  // the "model" side; the practitioner is the "user" side.
  const out: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const m of history) {
    if (m.role === "user") {
      out.push({ role: "user", parts: [{ text: m.text }] });
    } else if (m.role === "character") {
      out.push({ role: "model", parts: [{ text: m.text }] });
    }
  }
  // Gemini requires the FIRST item to be from the user. If our log starts
  // with the character's opening line, prepend a placeholder user turn.
  if (out.length === 0 || out[0].role !== "user") {
    out.unshift({
      role: "user",
      parts: [
        {
          text: `（ここから会話を始めます。${characterName} から自然に話しかけてください。）`,
        },
      ],
    });
  }
  return out;
}

function clampProbs(raw: unknown): EmotionProbs {
  const fallback: EmotionProbs = {
    joy: 0.25,
    calm: 0.25,
    anxiety: 0.25,
    confusion: 0.25,
  };
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const num = (k: keyof EmotionProbs): number => {
    const v = r[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return 0.25;
    return Math.max(0.01, Math.min(1, v));
  };
  return normalize({
    joy: num("joy"),
    calm: num("calm"),
    anxiety: num("anxiety"),
    confusion: num("confusion"),
  });
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function runGeminiTurn(input: LLMInput): Promise<TurnResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new NoLLMKeyError("GEMINI_API_KEY not set");

  const c = CHARACTERS[input.characterId];
  if (!c) throw new LLMCallError(`unknown character_id: ${input.characterId}`);

  const systemPrompt = buildSystemPrompt(input.characterId, input.sceneId);
  const history = buildHistoryContents(input.history, c.name);

  // Append the practitioner's latest line, augmented with state hints. For
  // proactive/expand cases we synthesise a directive instead.
  let lastUserText: string;
  if (input.proactive) {
    lastUserText =
      "（練習者は黙っている。間が空いている。あなた側から自然に話しかけてください。）";
  } else if (input.expand) {
    lastUserText =
      "（練習者の返事が短かった。あなたから話題を広げる質問を1つしてください。）";
  } else {
    lastUserText = input.userText;
  }
  history.push({ role: "user", parts: [{ text: lastUserText }] });

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: history,
    generationConfig: {
      temperature: 0.85,
      topP: 0.95,
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
    },
  };

  const start = performance.now();
  let res: Response;
  try {
    res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new LLMCallError(`network: ${(e as Error).message}`);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new LLMCallError(`gemini ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const llmMs = performance.now() - start;

  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new LLMCallError("empty response from Gemini");

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LLMCallError("Gemini returned non-JSON despite responseSchema");
  }

  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  if (!reply) throw new LLMCallError("Gemini returned empty reply");

  const emo = clampProbs(parsed.emotion);
  const dom = dominant(emo);
  const reaction =
    typeof parsed.reaction === "string" && parsed.reaction.trim()
      ? parsed.reaction.trim()
      : c.bubbles[dom][0];
  const reception =
    typeof parsed.reception === "string" && parsed.reception.trim()
      ? parsed.reception.trim()
      : undefined;

  const characterMessage: Message = {
    id: `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    role: "character",
    speaker: c.id,
    text: reply,
    timestamp: Date.now(),
    emotion: emo,
    dominant: dom,
    reactionBubble: reaction,
    receptionSummary: reception,
    proactive: input.proactive,
    expanded: input.expand,
    redoCount: input.redoCount,
  };

  return {
    characterMessage,
    inferenceMeta: {
      // We're not running the quantum circuit yet — surface the LLM time
      // under the slot we have and leave quantumInferenceMs as a placeholder.
      quantumInferenceMs: 0,
      llmInferenceMs: +llmMs.toFixed(1),
      dominantEmotion: dom,
      entropyBits: +entropy(emo).toFixed(3),
      emotionDelta: {
        joy: +(emo.joy - input.prevEmotion.joy).toFixed(3),
        calm: +(emo.calm - input.prevEmotion.calm).toFixed(3),
        anxiety: +(emo.anxiety - input.prevEmotion.anxiety).toFixed(3),
        confusion: +(emo.confusion - input.prevEmotion.confusion).toFixed(3),
      },
    },
  };
}
