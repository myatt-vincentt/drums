// The home page: the first thing you see, before anything heavy has loaded.
// A dark gradient (then, once the studio is loaded, the studio itself, dimmed
// and blurred behind glass), the title, one line, and one big Start button
// that fills as the studio, the kit, the hands and the sounds load in the
// background. Start turns the sound on and asks for the camera; tapped early,
// it carries on by itself as soon as everything is ready. Then the page fades
// and the kit is yours. It shows once each time the page opens.
import { useEffect, useRef, useState } from "react";
import { DefaultLoadingManager } from "three";

import { sound } from "./audio";
import { drums, enter, start, useDrumsVersion } from "./state";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ACCENT = "#f4d968";
/** The page fades out over this long (ms). */
const LEAVE_MS = 450;
/** The 3D files to load at least (so the bar can't fill early). */
const MIN_FILES = 8;

const CSS = `
.dh-root { position: fixed; inset: 0; z-index: 40; color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; overflow: hidden;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none;
  transition: opacity ${LEAVE_MS}ms ${EASE}; }
.dh-root.leave { opacity: 0; pointer-events: none; }
.dh-veil { position: absolute; inset: 0; background: rgb(12 11 16 / .5);
  backdrop-filter: blur(18px) saturate(1.2); -webkit-backdrop-filter: blur(18px) saturate(1.2); }
.dh-grad { position: absolute; inset: 0; transition: opacity 900ms ${EASE};
  background: radial-gradient(120% 80% at 50% 28%, #3b2c58 0%, #1b1824 52%, #0c0b10 100%); }
.dh-grad.gone { opacity: 0; }
.dh-body { position: relative; display: flex; flex-direction: column; align-items: center; gap: 14px;
  padding: 0 24px; animation: dh-in 600ms ${EASE} both; }
@keyframes dh-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.dh-mark { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; margin-bottom: 6px;
  background: rgb(35 37 40 / .6); border: 1px solid rgb(235 246 253 / .18);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / .22), 0 8px 24px rgb(0 0 0 / .25); color: ${ACCENT}; }
.dh-title { margin: 0; font: 650 48px/1 system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: -0.02em; }
.dh-line { margin: 0; max-width: 300px; font: 500 16px/1.4 system-ui, -apple-system, sans-serif;
  color: rgb(255 255 255 / .72); }
.dh-start { position: relative; margin-top: 22px; width: 220px; height: 60px; border-radius: 999px; padding: 0;
  overflow: hidden; cursor: pointer; outline: none; color: #fff; touch-action: manipulation;
  font: 650 18px/1 system-ui, -apple-system, sans-serif; letter-spacing: .01em;
  background: rgb(35 37 40 / .64); border: 1px solid rgb(235 246 253 / .22);
  backdrop-filter: blur(20px) saturate(1.5); -webkit-backdrop-filter: blur(20px) saturate(1.5);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / .22), 0 10px 30px rgb(0 0 0 / .3);
  transition: background 360ms ${EASE}, color 360ms ${EASE}, transform 160ms ease-out; }
.dh-start:active { transform: scale(0.97); }
.dh-start:focus-visible { box-shadow: 0 0 0 2px ${ACCENT}; }
.dh-start.ready { background: ${ACCENT}; color: #232528; border-color: transparent; }
.dh-fill { position: absolute; inset: 0; transform-origin: 0 50%; background: rgb(244 217 104 / .26);
  transition: transform 300ms ${EASE}; }
.dh-start.ready .dh-fill { opacity: 0; }
.dh-label { position: relative; display: inline-flex; align-items: center; gap: 10px; }
.dh-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid currentColor;
  border-right-color: transparent; animation: dh-spin 900ms linear infinite; }
@keyframes dh-spin { to { transform: rotate(360deg); } }
.dh-credit { position: absolute; left: 16px; right: 16px; bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
  font: 500 11px/1.4 system-ui, -apple-system, sans-serif; color: rgb(255 255 255 / .5); }
@media (prefers-reduced-motion: reduce) { .dh-body { animation: none; } .dh-spin { animation-duration: 2s; } }
`;

/** A snare drum with two sticks. */
const Mark = () => (
  <svg
    viewBox="0 0 24 24"
    width={30}
    height={30}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <ellipse cx="12" cy="13" rx="8" ry="2.8" />
    <path d="M4 13v4.5c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V13" />
    <path d="M8 15.6v4.2M12 16v4.3M16 15.6v4.2" opacity=".6" />
    <path d="M5.5 3.5l6 8M18.5 3.5l-6 8" strokeWidth={2} />
  </svg>
);

/** The 3D files (models, maps) loaded so far, out of those asked for. */
const files = { loaded: 0, total: 0 };
DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  files.loaded = loaded;
  files.total = total;
};

/** How far the background loading has got, 0..1 (never goes back). */
const useLoaded = (active: boolean) => {
  const [, tick] = useState(0);
  useEffect(() => {
    sound.preload();
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    const t = window.setInterval(() => tick((n) => n + 1), 120);
    return () => window.clearInterval(t);
  }, [active]);
  const { meter } = sound;
  const soundShare = meter.total > 0 ? meter.loaded / meter.total : 0;
  const fileShare = drums.loaded
    ? 1
    : Math.min(0.97, files.loaded / Math.max(files.total, MIN_FILES));
  const now = 0.75 * fileShare + 0.25 * soundShare;
  const best = useRef(0);
  best.current = Math.max(best.current, now);
  return { share: best.current, done: drums.loaded && soundShare >= 1 };
};

/**
 * The home page. `ready` is the camera running; `failed`, the camera refused
 * (the page then gives way to the camera message).
 */
export const Home = ({
  ready,
  failed,
}: {
  ready: boolean;
  failed: boolean;
}) => {
  useDrumsVersion();
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const { share, done } = useLoaded(!gone);

  const through = drums.started && done && (ready || failed);
  useEffect(() => {
    if (through) setLeaving(true);
  }, [through]);
  useEffect(() => {
    if (!leaving) return undefined;
    const t = window.setTimeout(() => {
      setGone(true);
      enter();
    }, LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);

  if (gone) return null;
  const waiting = drums.started && !through;
  return (
    <div
      className={`dh-root ${leaving ? "leave" : ""}`}
      data-hud="home"
      role="dialog"
      aria-label="Drums"
    >
      <style>{CSS}</style>
      <div className="dh-veil" />
      <div className={`dh-grad ${drums.loaded ? "gone" : ""}`} />
      <div className="dh-body">
        <div className="dh-mark">
          <Mark />
        </div>
        <h1 className="dh-title">Drums</h1>
        <p className="dh-line">Play a real drum kit with your hands</p>
        <button
          type="button"
          data-hud="start"
          className={`dh-start ${done ? "ready" : ""}`}
          aria-busy={waiting}
          onClick={start}
        >
          <span
            className="dh-fill"
            style={{ transform: `scaleX(${share})` }}
            aria-hidden="true"
          />
          <span className="dh-label">
            Start
            {waiting ? <span className="dh-spin" aria-hidden="true" /> : null}
          </span>
        </button>
      </div>
      <div className="dh-credit">
        Drum sounds: CrocellKit by the DrumGizmo team (CC BY 4.0)
      </div>
    </div>
  );
};
