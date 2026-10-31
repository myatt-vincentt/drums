// The page UI, minimal, on glass, top right:
//   - your camera (CameraFrame.tsx): tap it to tuck it away; a small camera
//     button then sits in the corner to bring it back
//   - under it, four chips: songs (a music note: opens the card of songs and
//     beats to Learn or Play; while one runs it stops it), hand tracking on /
//     off (off at first: play by tap, click or keys), the view (each tap goes
//     to the next view: drummer, front, top) and the studio light (sun / moon)
//   - after a song: its stars (tap to close)
import { useEffect, useState, type ReactNode } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";

import { frameRect, GUTTER, pinToScreen, type View } from "./layout";
import {
  bestStars,
  nextSongId,
  progressLine,
  startSong,
  stopSong,
} from "./SongPlayer";
import { CHARTS } from "./songs";
import {
  drums,
  nextView,
  setNight,
  toggleCam,
  toggleHands,
  useDrumsVersion,
} from "./state";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ACCENT = "#f4d968";

const CSS = `
.dr-root { position: absolute; inset: 0; pointer-events: none; color: #fff;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.dr-glass { background: rgb(35 37 40 / .64);
  backdrop-filter: blur(20px) saturate(1.5); -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border: 1px solid rgb(235 246 253 / .18);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / .22), 0 8px 24px rgb(0 0 0 / .22); }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .dr-glass { background: rgb(35 37 40 / .82); } }
.dr-chips { position: absolute; display: flex; gap: 8px; transition: top 350ms ${EASE}; }
.dr-btn { pointer-events: auto; border: 0; padding: 0; margin: 0; color: inherit; position: relative;
  display: grid; place-items: center; cursor: pointer; outline: none; touch-action: manipulation;
  width: 44px; height: 44px; border-radius: 50%; transition: transform 160ms ease-out, opacity 300ms ${EASE}; }
.dr-btn:active { transform: scale(0.94); }
.dr-btn:focus-visible { box-shadow: 0 0 0 2px ${ACCENT}; }
.dr-btn .dr-mark { position: absolute; bottom: -2px; right: -2px; width: 18px; height: 18px;
  border-radius: 50%; background: ${ACCENT}; color: #232528; display: grid; place-items: center;
  font: 700 10px/1 system-ui, -apple-system, sans-serif; }
.dr-cam { position: absolute; pointer-events: auto; border: 0; padding: 0; margin: 0;
  background: transparent; cursor: pointer; border-radius: 16px; outline: none; }
.dr-cam:focus-visible { box-shadow: 0 0 0 2px ${ACCENT}; }
.dr-pill { width: auto; padding: 0 14px 0 11px; border-radius: 22px; gap: 7px;
  display: flex; align-items: center; font: 600 13px/1 system-ui, -apple-system, sans-serif;
  white-space: nowrap; }
.dr-pill.on { box-shadow: inset 0 0 0 1.5px ${ACCENT}; }
.dr-card { position: absolute; pointer-events: auto; border-radius: 18px; padding: 10px;
  display: flex; flex-direction: column; gap: 6px; min-width: 244px;
  animation: dr-in 260ms ${EASE} both; }
@keyframes dr-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.dr-row { display: flex; align-items: center; gap: 8px; }
.dr-row .dr-title { flex: 1; font: 600 14px/1.2 system-ui, -apple-system, sans-serif; padding-left: 4px; }
.dr-small { pointer-events: auto; border: 1px solid rgb(235 246 253 / .22); background: rgb(255 255 255 / .08);
  color: #fff; border-radius: 999px; height: 32px; padding: 0 12px; cursor: pointer;
  font: 600 12px/1 system-ui, -apple-system, sans-serif; transition: transform 160ms ease-out; }
.dr-small:active { transform: scale(0.95); }
.dr-small.play { background: ${ACCENT}; color: #232528; border-color: transparent; }
.dr-small.on { box-shadow: inset 0 0 0 1.5px ${ACCENT}; }
.dr-stars { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); pointer-events: auto;
  display: flex; gap: 6px; padding: 12px 18px; border-radius: 22px; cursor: pointer;
  animation: dr-pop 420ms ${EASE} both; }
@keyframes dr-pop { from { opacity: 0; transform: translate(-50%, 10px) scale(.92); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
.dr-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
  background: rgb(255 255 255 / .12); }
.dr-progress > div { height: 100%; background: ${ACCENT}; transform-origin: 0 50%;
  transform: scaleX(0); box-shadow: 0 0 8px ${ACCENT}; }
.dr-best { display: flex; gap: 1px; margin-right: 2px; }
.dr-end { display: flex; align-items: center; gap: 10px; }
.dr-end .dr-icon { pointer-events: auto; width: 36px; height: 36px; border-radius: 50%; border: 0;
  background: rgb(255 255 255 / .1); color: #fff; display: grid; place-items: center; cursor: pointer;
  transition: transform 160ms ease-out; }
.dr-end .dr-icon:active { transform: scale(0.94); }
.dr-show { position: absolute; right: ${GUTTER}px; top: ${GUTTER}px; }
.dr-gone { opacity: 0; pointer-events: none; }
`;

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width={20}
    height={20}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const CameraIcon = () => (
  <Icon>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
);
const HandIcon = () => (
  <Icon>
    <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5V4.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.3 14.6a1.6 1.6 0 0 1 2.4-2.1L8 14" />
  </Icon>
);
const NoteIcon = () => (
  <Icon>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </Icon>
);
const StopIcon = () => (
  <Icon>
    <rect x="7" y="7" width="10" height="10" rx="2" />
  </Icon>
);
const Star = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width={34} height={34} aria-hidden="true">
    <path
      d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
      fill={on ? ACCENT : "rgb(255 255 255 / .18)"}
      stroke={on ? ACCENT : "rgb(255 255 255 / .45)"}
      strokeWidth={1.2}
      strokeLinejoin="round"
    />
  </svg>
);
const AgainIcon = () => (
  <Icon>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v4.5h4.5" />
  </Icon>
);
const NextIcon = () => (
  <Icon>
    <path d="M6 5.5l9 6.5-9 6.5z" fill="currentColor" />
    <path d="M18 5v14" />
  </Icon>
);
const SmallStar = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden="true">
    <path
      d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
      fill={on ? ACCENT : "rgb(255 255 255 / .22)"}
    />
  </svg>
);
const ViewIcon = () => (
  <Icon>
    <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Icon>
);
const MoonIcon = () => (
  <Icon>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </Icon>
);

const VIEW_MARK: Record<View, string> = { drummer: "1", front: "2", top: "3" };
const VIEW_NAME: Record<View, string> = {
  drummer: "View: drummer's seat",
  front: "View: front",
  top: "View: top",
};

/** The stars stay up this long after a song (ms). */
const STARS_FOR = 5000;

export const Hud = () => {
  useDrumsVersion();
  const [, tick] = useState(0);
  const finishedAt = drums.finish?.at ?? null;
  useEffect(() => {
    if (finishedAt === null) return undefined;
    const t = window.setTimeout(() => tick((n) => n + 1), STARS_FOR);
    return () => window.clearTimeout(t);
  }, [finishedAt]);
  const showStars =
    drums.finish !== null && performance.now() - drums.finish.at < STARS_FOR;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const frame = frameRect(width, height);
  const tall = height > width;
  const best = drums.songCard ? bestStars() : {};
  const hidden = drums.camHidden;
  const chipsTop = hidden ? GUTTER + 44 + 10 : frame.top + frame.height + 10;

  return (
    <Html
      fullscreen
      calculatePosition={pinToScreen}
      zIndexRange={[30, 0]}
      style={{ pointerEvents: "none" }}
    >
      <style>{CSS}</style>
      <div className="dr-root">
        <button
          type="button"
          data-hud="camera"
          className={`dr-cam ${hidden ? "dr-gone" : ""}`}
          aria-label="Hide your camera"
          style={{
            left: frame.left,
            top: frame.top,
            width: frame.width,
            height: frame.height,
          }}
          onClick={toggleCam}
        />
        <button
          type="button"
          data-hud="camera-show"
          className={`dr-btn dr-glass dr-show ${hidden ? "" : "dr-gone"}`}
          aria-label="Show your camera"
          onClick={toggleCam}
        >
          <CameraIcon />
        </button>
        <div className="dr-chips" style={{ top: chipsTop, right: GUTTER }}>
          <button
            type="button"
            data-hud="songs"
            className={`dr-btn dr-glass ${drums.session ? "dr-pill on" : ""}`}
            aria-label={drums.session ? "Stop the song" : "Songs and beats"}
            aria-expanded={drums.songCard}
            onClick={() => {
              if (drums.session) stopSong();
              else {
                drums.songCard = !drums.songCard;
                drums.changed();
              }
            }}
          >
            {drums.session ? <StopIcon /> : <NoteIcon />}
          </button>
          <button
            type="button"
            data-hud="hands"
            className={`dr-btn dr-glass dr-pill ${drums.handsOn ? "on" : ""}`}
            aria-pressed={drums.handsOn}
            onClick={toggleHands}
          >
            <HandIcon />
            {drums.handsOn ? "Hands on" : "Hands off"}
          </button>
          <button
            type="button"
            data-hud="view"
            className="dr-btn dr-glass"
            aria-label={VIEW_NAME[drums.view]}
            onClick={nextView}
          >
            <ViewIcon />
            <span className="dr-mark">{VIEW_MARK[drums.view]}</span>
          </button>
          <button
            type="button"
            data-hud="light"
            className="dr-btn dr-glass"
            aria-label={
              drums.night
                ? "Night studio (tap for day)"
                : "Day studio (tap for night)"
            }
            onClick={() => setNight(!drums.night)}
          >
            {drums.night ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>
        {drums.songCard && !drums.session ? (
          <div
            className="dr-card dr-glass"
            data-hud="song-card"
            // On a tall screen the card sits up in the room, clear of the kit.
            style={
              tall
                ? { top: GUTTER + 48, left: GUTTER }
                : { top: chipsTop + 54, right: GUTTER }
            }
          >
            {CHARTS.map((c) => (
              <div className="dr-row" key={c.id}>
                <span className="dr-title">{c.title}</span>
                <span
                  className="dr-best"
                  aria-label={`Best: ${best[c.id] ?? 0} of 3 stars`}
                >
                  {[1, 2, 3].map((i) => (
                    <SmallStar key={i} on={i <= (best[c.id] ?? 0)} />
                  ))}
                </span>
                <button
                  type="button"
                  className="dr-small"
                  onClick={() => startSong(c.id, "learn")}
                >
                  Learn
                </button>
                <button
                  type="button"
                  className="dr-small play"
                  onClick={() => startSong(c.id, "play")}
                >
                  Play
                </button>
              </div>
            ))}
            <div className="dr-row" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className={`dr-small ${drums.slow ? "on" : ""}`}
                aria-pressed={drums.slow}
                onClick={() => {
                  drums.slow = !drums.slow;
                  drums.changed();
                }}
              >
                {drums.slow ? "Slow" : "Full speed"}
              </button>
            </div>
          </div>
        ) : null}
        {showStars && drums.finish ? (
          <div
            data-hud="stars"
            className="dr-stars dr-glass dr-end"
            style={tall ? { top: frame.top + frame.height + 76 } : undefined}
          >
            <span
              className="dr-end"
              style={{ gap: 4 }}
              aria-label={`${drums.finish.stars} of 3 stars`}
            >
              {[1, 2, 3].map((i) => (
                <Star key={i} on={i <= (drums.finish?.stars ?? 0)} />
              ))}
            </span>
            <button
              type="button"
              className="dr-icon"
              data-hud="again"
              aria-label="Again"
              onClick={() => startSong(drums.finish!.id, drums.finish!.mode)}
            >
              <AgainIcon />
            </button>
            <button
              type="button"
              className="dr-icon"
              data-hud="next"
              aria-label="Next"
              onClick={() =>
                startSong(nextSongId(drums.finish!.id), drums.finish!.mode)
              }
            >
              <NextIcon />
            </button>
          </div>
        ) : null}
        {drums.session ? (
          <div className="dr-progress" aria-hidden="true">
            <div
              ref={(el) => {
                progressLine.el = el;
              }}
            />
          </div>
        ) : null}
      </div>
    </Html>
  );
};
