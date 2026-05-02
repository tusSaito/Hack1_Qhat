import type { Scene } from "./types";

export const SCENES: Scene[] = [
  {
    id: "kanto_offline",
    title: "関東オフ会、開始10分前",
    description:
      "会場の隅に立っているあなた。同じくぽつんとしている咲良が、ちらちらこちらを見ている。声をかけてみる？",
    characterId: "sakura",
    durationMin: 5,
    difficulty: 1,
    initialEmotion: { joy: 0.18, calm: 0.22, anxiety: 0.42, confusion: 0.18 },
    openingLine: "あ……こんにちは。",
  },
  {
    id: "job_interview",
    title: "就活面接、入室3分前",
    description:
      "控室で他の就活生と二人きり。沈黙が続く。話しかけて気持ちをほぐすか、黙って待つか。",
    characterId: "takahashi",
    durationMin: 5,
    difficulty: 2,
    initialEmotion: { joy: 0.1, calm: 0.35, anxiety: 0.4, confusion: 0.15 },
    openingLine: "あ……えっと、お疲れ様です。",
  },
  {
    id: "senpai_ask",
    title: "苦手な先輩への返事",
    description:
      "先輩から頼まれた件、返事をしないといけない。気は使ってくれるけど、なんとなく合わない人。",
    characterId: "tanaka",
    durationMin: 3,
    difficulty: 3,
    initialEmotion: { joy: 0.05, calm: 0.4, anxiety: 0.3, confusion: 0.25 },
    openingLine: "おう、お疲れ。例の件、どう？",
  },
];

export function getScene(id: string): Scene | undefined {
  return SCENES.find((s) => s.id === id);
}
