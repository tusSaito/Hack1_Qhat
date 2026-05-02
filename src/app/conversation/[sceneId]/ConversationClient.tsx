"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Scene, TurnResponse, Message, EmotionProbs } from "@/lib/types";
import { CHARACTERS } from "@/lib/characters";
import { useQhat } from "@/lib/store";
import { ConversationLog } from "@/components/ConversationLog";
import { Waveform } from "@/components/Waveform";
import { CharacterPanel } from "@/components/CharacterPanel";
import { EmotionBars } from "@/components/EmotionBars";
import { DecoherenceMeter } from "@/components/DecoherenceMeter";
import { ReceptionPanel } from "@/components/ReceptionPanel";
import { useSpeechRecognition, speak } from "@/lib/speech";
import { dominant } from "@/lib/emotion";

const BlochSphere = dynamic(
  () => import("@/components/BlochSphere").then((m) => m.BlochSphere),
  { ssr: false, loading: () => <div className="aspect-square w-full bg-paper/50 rounded" /> }
);

const PROACTIVE_IDLE_MS = 15_000;
const PROACTIVE_COOLDOWN_MS = 20_000;
const PROACTIVE_MAX = 4;
const SILENCE_MS = 1_500;

export function ConversationClient({ scene }: { scene: Scene }) {
  const router = useRouter();
  const character = CHARACTERS[scene.characterId];
  const {
    setScene,
    messages,
    emotion,
    prevEmotion,
    decoherence,
    bumpDecoherence,
    setDecoherence,
    pushMessage,
    updateEmotion,
    draftText,
    setDraft,
    isRecording,
    setRecording,
    isThinking,
    setThinking,
    isSpeaking,
    setSpeaking,
    redoCount,
    incRedo,
    resetRedo,
    registerInteraction,
    registerProactive,
    proactiveCount,
    lastProactiveAt,
    lastInteractionAt,
    proactiveEnabled,
    toggleProactive,
  } = useQhat();

  const [level, setLevel] = useState(0);
  const lastSoundAtRef = useRef<number>(Date.now());
  const lastReaction = messages[messages.length - 1]?.reactionBubble;
  const lastReactionId = messages[messages.length - 1]?.id;

  // initialise scene once
  useEffect(() => {
    setScene(scene);
    // speak the opening line
    if (scene.openingLine) {
      const c = CHARACTERS[scene.characterId];
      setSpeaking(true);
      speak(scene.openingLine, {
        ...c.voice,
        onEnd: () => setSpeaking(false),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  const recognition = useSpeechRecognition({
    onInterim: (text) => setDraft(text),
    onFinal: (text) => setDraft(text),
    onLevel: (rms) => {
      setLevel(rms);
      if (rms > 0.04) lastSoundAtRef.current = Date.now();
    },
  });

  const handleStartRecording = useCallback(async () => {
    if (isThinking || isSpeaking) return;
    registerInteraction();
    setDraft("");
    recognition.resetFinal();
    lastSoundAtRef.current = Date.now();
    await recognition.start();
    setRecording(true);
  }, [
    isThinking,
    isSpeaking,
    recognition,
    registerInteraction,
    setDraft,
    setRecording,
  ]);

  const handleStopRecording = useCallback(() => {
    recognition.stop();
    setRecording(false);
  }, [recognition, setRecording]);

  const handleRedo = useCallback(() => {
    handleStopRecording();
    setDraft("");
    incRedo();
    bumpDecoherence(-15);
    registerInteraction();
  }, [handleStopRecording, setDraft, incRedo, bumpDecoherence, registerInteraction]);

  // Use a ref so async continuations always read the latest fn (avoids stale
  // closures in the speech-onEnd → expand chain).
  const callTurnRef = useRef<
    (text: string, opts?: { proactive?: boolean; expand?: boolean }) => Promise<void>
  >(async () => {});

  const callTurn = useCallback(
    async (
      userText: string,
      opts: { proactive?: boolean; expand?: boolean } = {}
    ) => {
      setThinking(true);
      // Read latest emotion at call time, not closure-captured time.
      const latestEmotion = useQhat.getState().emotion;
      const latestRedo = useQhat.getState().redoCount;
      let data: TurnResponse;
      try {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_text: userText,
            prev_emotion: latestEmotion,
            character_id: scene.characterId,
            redo_count: latestRedo,
            proactive: opts.proactive,
            expand: opts.expand,
          }),
        });
        if (!res.ok) throw new Error(`turn failed: ${res.status}`);
        data = await res.json();
      } catch {
        setThinking(false);
        return;
      }
      const msg = data.characterMessage;
      updateEmotion(msg.emotion!);
      pushMessage(msg);
      setDecoherence(0);
      setThinking(false);
      setSpeaking(true);
      speak(msg.text, {
        ...character.voice,
        onEnd: () => {
          setSpeaking(false);
          if (
            !opts.proactive &&
            !opts.expand &&
            userText.trim().length <= 5 &&
            userText.trim().length > 0 &&
            Math.random() < 0.5
          ) {
            setTimeout(() => callTurnRef.current("", { expand: true }), 800);
          }
        },
      });
    },
    [
      character.voice,
      pushMessage,
      scene.characterId,
      setDecoherence,
      setSpeaking,
      setThinking,
      updateEmotion,
    ]
  );

  useEffect(() => {
    callTurnRef.current = callTurn;
  }, [callTurn]);

  const handleObserve = useCallback(async () => {
    const text = draftText.trim();
    if (!text || isThinking || isSpeaking) return;
    handleStopRecording();
    bumpDecoherence(-25);
    registerInteraction();
    pushMessage({
      id: `msg_user_${Date.now()}`,
      role: "user",
      text,
      timestamp: Date.now(),
    });
    setDraft("");
    await callTurn(text);
    resetRedo();
  }, [
    bumpDecoherence,
    callTurn,
    draftText,
    handleStopRecording,
    isSpeaking,
    isThinking,
    pushMessage,
    registerInteraction,
    resetRedo,
    setDraft,
  ]);

  // decoherence ticker
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      if (isThinking || isSpeaking) return;
      if (isRecording) {
        const silentFor = now - lastSoundAtRef.current;
        if (silentFor > SILENCE_MS) bumpDecoherence(1.2);
        else bumpDecoherence(-0.3);
      } else {
        bumpDecoherence(0.4);
      }
    }, 200);
    return () => clearInterval(id);
  }, [isRecording, isThinking, isSpeaking, bumpDecoherence]);

  // proactive trigger
  useEffect(() => {
    const id = setInterval(() => {
      if (!proactiveEnabled) return;
      if (isThinking || isSpeaking || isRecording) return;
      if (proactiveCount >= PROACTIVE_MAX) return;
      const now = Date.now();
      const idle = now - lastInteractionAt;
      const cooldown = now - lastProactiveAt;
      if (idle >= PROACTIVE_IDLE_MS && cooldown >= PROACTIVE_COOLDOWN_MS) {
        registerProactive();
        registerInteraction();
        callTurn("", { proactive: true });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [
    callTurn,
    isRecording,
    isSpeaking,
    isThinking,
    lastInteractionAt,
    lastProactiveAt,
    proactiveCount,
    proactiveEnabled,
    registerInteraction,
    registerProactive,
  ]);

  const silentNow =
    isRecording && Date.now() - lastSoundAtRef.current > SILENCE_MS;
  const lastCharMessage = [...messages].reverse().find((m) => m.role === "character");

  return (
    <main className="min-h-screen flex flex-col">
      {/* header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-line bg-paper">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-mincho text-lg hover:text-gold">
            Qhat
          </Link>
          <span className="text-ink-pale">/</span>
          <span className="font-mincho text-sm text-ink-soft">{scene.title}</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={proactiveEnabled}
              onChange={toggleProactive}
              className="accent-gold"
            />
            向こうから話しかけ
          </label>
          <Link
            href={`/review/${scene.id}`}
            className="text-xs px-3 py-1.5 border border-line rounded hover:border-ink"
          >
            終了
          </Link>
        </div>
      </header>

      {/* body */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px] gap-0">
        {/* LEFT: Character */}
        <aside className="border-r border-line bg-paper/40 px-5 py-6 flex flex-col">
          <CharacterPanel
            characterId={scene.characterId}
            emotion={emotion}
            decoherence={decoherence}
            reactionBubble={lastReaction}
            reactionKey={lastReactionId}
            thinking={isThinking}
            proactive={lastCharMessage?.proactive}
          />
        </aside>

        {/* CENTER: Log + recorder */}
        <section className="flex flex-col h-[calc(100vh-49px)]">
          <ConversationLog messages={messages} />
          <div className="border-t border-line bg-white px-6 py-4">
            {/* draft */}
            <div className="min-h-[44px] mb-3 rounded border border-line bg-paper/50 px-3 py-2 font-mincho text-sm text-ink">
              {draftText || (
                <span className="text-ink-pale">
                  {isRecording
                    ? "聞いています…"
                    : isThinking
                    ? "考え中…"
                    : isSpeaking
                    ? "話しています…"
                    : "🎤 を押して話してみて"}
                </span>
              )}
            </div>
            <Waveform level={level} silent={silentNow} active={isRecording} />
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={
                    isRecording ? handleStopRecording : handleStartRecording
                  }
                  disabled={isThinking || isSpeaking}
                  className={`h-12 w-12 rounded-full flex items-center justify-center text-lg transition disabled:opacity-40 ${
                    isRecording
                      ? "bg-gold text-white animate-pulse-gold"
                      : "border border-ink text-ink hover:bg-ink hover:text-paper"
                  }`}
                  aria-label={isRecording ? "録音停止" : "録音開始"}
                >
                  🎤
                </button>
                <button
                  onClick={handleRedo}
                  disabled={!draftText || isThinking || isSpeaking}
                  className="px-3 py-2 text-xs border border-gold text-gold rounded hover:bg-gold-soft disabled:opacity-30"
                >
                  録り直す
                  {redoCount > 0 && (
                    <span className="mono ml-1 text-ink-pale">×{redoCount}</span>
                  )}
                </button>
              </div>
              <button
                onClick={handleObserve}
                disabled={!draftText.trim() || isThinking || isSpeaking}
                className="px-6 py-2.5 bg-ink text-paper text-sm font-mincho rounded hover:bg-ink-soft disabled:opacity-30"
              >
                観測する →
              </button>
            </div>
            {!recognition.supported && (
              <p className="mt-2 text-[11px] text-purple">
                このブラウザは音声認識に未対応です。Chrome / Edge をご利用ください。
              </p>
            )}
          </div>
        </section>

        {/* RIGHT: Quantum panel */}
        <aside className="border-l border-line bg-paper/40 px-5 py-6 space-y-5 overflow-y-auto h-[calc(100vh-49px)] scrollbar-thin">
          <div>
            <p className="label-en text-xs mb-2">Bloch Sphere</p>
            <BlochSphere probs={emotion} decoherence={decoherence} />
          </div>
          <div>
            <p className="label-en text-xs mb-2">Emotion</p>
            <EmotionBars probs={emotion} />
          </div>
          <DecoherenceMeter value={decoherence} />
          <ReceptionPanel
            prev={prevEmotion}
            curr={emotion}
            summary={lastCharMessage?.receptionSummary}
          />
        </aside>
      </div>
    </main>
  );
}
