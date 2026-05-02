export type Emotion = "joy" | "calm" | "anxiety" | "confusion";

export type EmotionProbs = Record<Emotion, number>;

export type Role = "user" | "character";

export interface Message {
  id: string;
  role: Role;
  speaker?: string;
  text: string;
  timestamp: number;
  emotion?: EmotionProbs;
  dominant?: Emotion;
  reactionBubble?: string;
  receptionSummary?: string;
  proactive?: boolean;
  expanded?: boolean;
  redoCount?: number;
}

export interface SceneCharacter {
  id: string;
  name: string;
  age: number;
  voice: { pitch: number; rate: number };
  accent: string;
  bubbles: Record<Emotion, string[]>;
  templates: Record<Emotion, string[]>;
  proactiveLines: string[];
  expandLines: string[];
}

export interface Scene {
  id: string;
  title: string;
  description: string;
  characterId: string;
  durationMin: number;
  difficulty: 1 | 2 | 3;
  initialEmotion: EmotionProbs;
  openingLine?: string;
}

export interface InferenceMeta {
  quantumInferenceMs: number;
  llmInferenceMs: number;
  dominantEmotion: Emotion;
  entropyBits: number;
  emotionDelta: EmotionProbs;
}

export interface TurnResponse {
  characterMessage: Message;
  inferenceMeta: InferenceMeta;
}
