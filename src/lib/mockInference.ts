import type { Emotion, EmotionProbs, Message, TurnResponse } from "./types";
import { CHARACTERS } from "./characters";
import { dominant, entropy, normalize } from "./emotion";

interface Heuristic {
  pattern: RegExp;
  bias: Partial<Record<Emotion, number>>;
}

const HEURISTICS: Heuristic[] = [
  { pattern: /(ありがとう|嬉し|楽し|好き|いいね|素敵)/, bias: { joy: 0.35, anxiety: -0.15 } },
  { pattern: /(こんにち|はじめまして|よろしく|お疲れ)/, bias: { calm: 0.2, joy: 0.1, anxiety: -0.1 } },
  { pattern: /(ごめん|すみません|申し訳)/, bias: { calm: 0.18, anxiety: -0.05 } },
  { pattern: /(\?|？|なに|なん|どう|どこ|いつ|だれ)/, bias: { confusion: 0.18 } },
  { pattern: /(怖|嫌|無理|やめ|帰り)/, bias: { anxiety: 0.3, calm: -0.15, joy: -0.15 } },
  { pattern: /(え|うーん|あの|えっと|……|\.\.\.)/, bias: { confusion: 0.12, anxiety: 0.08 } },
  { pattern: /(笑|ｗ|w$|！|!)/, bias: { joy: 0.18 } },
  { pattern: /(映画|カフェ|本|音楽|趣味)/, bias: { joy: 0.18, calm: 0.1 } },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function applyBias(prev: EmotionProbs, biasSum: Partial<Record<Emotion, number>>): EmotionProbs {
  const next: EmotionProbs = {
    joy: Math.max(0.02, prev.joy + (biasSum.joy ?? 0)),
    calm: Math.max(0.02, prev.calm + (biasSum.calm ?? 0)),
    anxiety: Math.max(0.02, prev.anxiety + (biasSum.anxiety ?? 0)),
    confusion: Math.max(0.02, prev.confusion + (biasSum.confusion ?? 0)),
  };
  // soft pull toward neutral
  const decay = 0.85;
  const mix = 0.06;
  return normalize({
    joy: next.joy * decay + mix,
    calm: next.calm * decay + mix,
    anxiety: next.anxiety * decay + mix,
    confusion: next.confusion * decay + mix,
  });
}

function computeBias(text: string): Partial<Record<Emotion, number>> {
  const acc: Record<Emotion, number> = { joy: 0, calm: 0, anxiety: 0, confusion: 0 };
  for (const h of HEURISTICS) {
    if (h.pattern.test(text)) {
      for (const k of Object.keys(h.bias) as Emotion[]) {
        acc[k] += h.bias[k] ?? 0;
      }
    }
  }
  // tiny noise
  for (const k of Object.keys(acc) as Emotion[]) {
    acc[k] += (Math.random() - 0.5) * 0.04;
  }
  // very short input → confusion bump
  if (text.trim().length <= 3) acc.confusion += 0.1;
  return acc;
}

function summarize(prev: EmotionProbs, curr: EmotionProbs): string {
  const prevDom = dominant(prev);
  const currDom = dominant(curr);
  if (prevDom === currDom) {
    const map: Record<Emotion, string> = {
      joy: "そのまま嬉しそう",
      calm: "落ち着いている",
      anxiety: "まだ少し緊張している",
      confusion: "まだ少し戸惑っている",
    };
    return map[currDom];
  }
  const transitions: Record<string, string> = {
    "anxiety→joy": "あなたの言葉で安心した",
    "anxiety→calm": "少し肩の力が抜けた",
    "confusion→calm": "意図が伝わったみたい",
    "confusion→joy": "意外だったみたい、嬉しそう",
    "calm→joy": "もっと聞きたそう",
    "joy→anxiety": "急に不安になったみたい",
    "calm→anxiety": "ちょっと身構えた",
    "joy→confusion": "戸惑わせたかも",
    "calm→confusion": "うまく伝わらなかった",
    "anxiety→confusion": "余計わからなくなったみたい",
    "joy→calm": "落ち着いてきた",
    "confusion→anxiety": "不安になってきた",
  };
  return transitions[`${prevDom}→${currDom}`] ?? "感情が動いた";
}

export interface InferenceInput {
  userText: string;
  prevEmotion: EmotionProbs;
  characterId: string;
  redoCount: number;
  proactive?: boolean;
  expand?: boolean;
}

export function runMockTurn(input: InferenceInput): TurnResponse {
  const c = CHARACTERS[input.characterId];
  const start = performance.now();
  const bias = computeBias(input.userText);
  const next = applyBias(input.prevEmotion, bias);
  const dom = dominant(next);

  let text: string;
  if (input.proactive) {
    text = pick(c.proactiveLines);
  } else if (input.expand) {
    text = pick(c.expandLines);
  } else {
    text = pick(c.templates[dom]);
  }

  const reaction = pick(c.bubbles[dom]);
  const summary = summarize(input.prevEmotion, next);
  const quantumMs = +(20 + Math.random() * 90).toFixed(1);
  const llmMs = +(performance.now() - start + 200 + Math.random() * 600).toFixed(1);

  const characterMessage: Message = {
    id: `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    role: "character",
    speaker: c.id,
    text,
    timestamp: Date.now(),
    emotion: next,
    dominant: dom,
    reactionBubble: reaction,
    receptionSummary: summary,
    proactive: input.proactive,
    expanded: input.expand,
    redoCount: input.redoCount,
  };

  return {
    characterMessage,
    inferenceMeta: {
      quantumInferenceMs: quantumMs,
      llmInferenceMs: llmMs,
      dominantEmotion: dom,
      entropyBits: +entropy(next).toFixed(3),
      emotionDelta: {
        joy: +(next.joy - input.prevEmotion.joy).toFixed(3),
        calm: +(next.calm - input.prevEmotion.calm).toFixed(3),
        anxiety: +(next.anxiety - input.prevEmotion.anxiety).toFixed(3),
        confusion: +(next.confusion - input.prevEmotion.confusion).toFixed(3),
      },
    },
  };
}
