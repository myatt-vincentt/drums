// Sound on a tap. The kit's sounds load straight away; until the first tap
// (browsers only start audio on one) a small glass speaker pulses at the top
// of the screen, wordless. Any tap starts the sound (a tap on a drum also
// plays it) and the speaker fades away.
import { useEffect, useState } from "react";
import { Html } from "@react-three/drei";

import { sound } from "./audio";

const SIZE = 44;

const Glyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
    <path
      d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const PULSE = `
@keyframes drums-speaker-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
  50% { transform: scale(1.06); box-shadow: 0 0 18px 2px rgba(255, 255, 255, 0.35); }
}`;

export const Sound = () => {
  const [on, setOn] = useState(sound.unlocked);
  const [gone, setGone] = useState(sound.unlocked);

  useEffect(() => {
    sound.preload();
  }, []);

  // Any tap starts the sound (the speaker is the visible invitation).
  useEffect(() => {
    if (on) return undefined;
    const start = () => {
      sound.unlock();
      setOn(true);
    };
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, [on]);

  useEffect(() => {
    if (!on) return undefined;
    const t = window.setTimeout(() => setGone(true), 450);
    return () => window.clearTimeout(t);
  }, [on]);

  if (gone) return null;
  return (
    <Html fullscreen zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
      <style>{PULSE}</style>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "calc(env(safe-area-inset-top, 0px) + 18px)",
          transform: "translateX(-50%)",
          opacity: on ? 0 : 1,
          transition: "opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <button
          type="button"
          aria-label="Tap for sound"
          onClick={() => {
            sound.unlock();
            setOn(true);
          }}
          style={{
            pointerEvents: on ? "none" : "auto",
            width: SIZE,
            height: SIZE,
            borderRadius: SIZE / 2,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "rgba(16, 16, 20, 0.42)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            cursor: "pointer",
            padding: 0,
            animation: "drums-speaker-pulse 1.8s ease-in-out infinite",
          }}
        >
          <Glyph />
        </button>
      </div>
    </Html>
  );
};
