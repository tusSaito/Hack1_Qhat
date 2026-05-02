import type { Emotion, EmotionProbs } from "./types";

const EMOTION_KEYS: Emotion[] = ["joy", "calm", "anxiety", "confusion"];

const ALLOWED_CHARACTER_IDS = new Set(["sakura", "takahashi", "tanaka"]);

export class ValidationError extends Error {}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export interface ValidatedTurnRequest {
  userText: string;
  prevEmotion: EmotionProbs;
  characterId: string;
  redoCount: number;
  proactive: boolean;
  expand: boolean;
}

const MAX_USER_TEXT = 2000;
const MAX_REDO_COUNT = 1000;

export function validateTurnRequest(raw: unknown): ValidatedTurnRequest {
  if (!isPlainObject(raw)) throw new ValidationError("body must be a JSON object");

  const userText = raw.user_text;
  if (typeof userText !== "string") throw new ValidationError("user_text must be string");
  if (userText.length > MAX_USER_TEXT) throw new ValidationError("user_text too long");

  const characterId = raw.character_id;
  if (typeof characterId !== "string" || !ALLOWED_CHARACTER_IDS.has(characterId)) {
    throw new ValidationError("invalid character_id");
  }

  const prev = raw.prev_emotion;
  if (!isPlainObject(prev)) throw new ValidationError("prev_emotion must be object");
  const prevEmotion = {} as EmotionProbs;
  for (const k of EMOTION_KEYS) {
    const v = (prev as Record<string, unknown>)[k];
    if (!isFiniteNumber(v) || v < 0 || v > 1) {
      throw new ValidationError(`prev_emotion.${k} must be number in [0,1]`);
    }
    prevEmotion[k] = v;
  }

  const redoCount = raw.redo_count ?? 0;
  if (!isFiniteNumber(redoCount) || redoCount < 0 || redoCount > MAX_REDO_COUNT) {
    throw new ValidationError("invalid redo_count");
  }

  return {
    userText,
    prevEmotion,
    characterId,
    redoCount: Math.floor(redoCount),
    proactive: raw.proactive === true,
    expand: raw.expand === true,
  };
}
