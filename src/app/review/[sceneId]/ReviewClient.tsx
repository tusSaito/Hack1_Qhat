"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Scene } from "@/lib/types";
import { useQhat } from "@/lib/store";
import { EmotionTrajectory } from "@/components/EmotionTrajectory";
import { dominant, EMOTION_LABEL } from "@/lib/emotion";

export function ReviewClient({ scene }: { scene: Scene }) {
  const { messages, redoCount } = useQhat();

  const stats = useMemo(() => {
    const charMessages = messages.filter((m) => m.role === "character");
    const userMessages = messages.filter((m) => m.role === "user");
    const turns = userMessages.length;
    const avgChars =
      turns === 0
        ? 0
        : Math.round(
            userMessages.reduce((a, m) => a + m.text.length, 0) / turns
          );
    const finalEmo = charMessages[charMessages.length - 1]?.emotion;
    const firstEmo = charMessages[0]?.emotion ?? scene.initialEmotion;
    return {
      turns,
      avgChars,
      redoCount,
      firstEmo,
      finalEmo,
      history: charMessages.map((m) => m.emotion!).filter(Boolean),
    };
  }, [messages, redoCount, scene.initialEmotion]);

  const startDom = dominant(stats.firstEmo);
  const endDom = stats.finalEmo ? dominant(stats.finalEmo) : startDom;

  return (
    <main className="mx-auto max-w-4xl px-8 py-12">
      <header className="mb-10">
        <p className="label-en text-xs">Review</p>
        <h1 className="font-mincho text-3xl mt-1">
          ふりかえり ・ {scene.title}
        </h1>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <Stat label="総ターン数" value={`${stats.turns}`} />
        <Stat label="平均文字数" value={`${stats.avgChars}`} />
        <Stat label="録り直し回数" value={`${stats.redoCount}`} />
        <Stat
          label="感情の変化"
          value={`${EMOTION_LABEL[startDom]} → ${EMOTION_LABEL[endDom]}`}
        />
      </section>

      <section className="mb-10">
        <p className="label-en text-xs mb-2">Emotion trajectory</p>
        <div className="rounded border border-line bg-white p-4">
          <EmotionTrajectory history={stats.history} />
        </div>
        <p className="mt-3 text-xs text-ink-pale font-mincho">
          縦軸は4感情の確率（合計100%）。横軸は会話のターン。
        </p>
      </section>

      <section className="mb-10 rounded border border-gold-soft bg-gold-soft/20 p-5">
        <p className="label-en text-xs mb-2">Graduation</p>
        <p className="font-mincho text-sm text-ink leading-relaxed">
          {stats.turns >= 5
            ? "今日のリハーサル、しっかり最後まで続けられました。本番でも、いまの感覚を信じて大丈夫。"
            : "あと数回のリハーサルで、本番で必要な「手応え」が掴めそうです。"}
        </p>
      </section>

      <div className="flex gap-3">
        <Link
          href={`/conversation/${scene.id}`}
          className="px-6 py-2.5 bg-ink text-paper text-sm font-mincho rounded hover:bg-ink-soft"
        >
          もう一度
        </Link>
        <Link
          href="/"
          className="px-6 py-2.5 border border-line text-sm font-mincho rounded hover:border-ink"
        >
          終了する
        </Link>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <p className="label-en text-[10px]">{label}</p>
      <p className="font-mincho text-xl mt-1">{value}</p>
    </div>
  );
}
