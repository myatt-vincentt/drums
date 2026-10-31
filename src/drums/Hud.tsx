// The page UI, minimal, on Night glass:
//   - your camera, top right (CameraFrame.tsx): tap it to tuck it away; a
//     small camera button then sits in the corner to bring it back
//   - one floating dock, bottom centre, icons only: songs (opens the card of
//     songs and beats; while one runs it stops it, and a thin line along the
//     dock's top shows how far through), hands (tracking on / off), the view
//     (drummer, front, top), day / night, and how to play. A small label
//     shows over a button on hover, or for a moment after a tap.
//   - the songs card just above the dock (on a tall screen, up in the room)
//   - after a song: its stars, again and next
//   - the how-to-play steps, the first time hands go on (or from the dock)
import { useEffect, useRef, useState, type ReactNode } from "react";
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
/** The dock's distance from the bottom edge (CSS px, above the safe area). */
const DOCK_BOTTOM = 22;
/** The dock's height (CSS px). */
const DOCK_HEIGHT = 56;
/** After a tap the label stays this long (ms). */
const TAP_LABEL = 1000;

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
.dr-dock { position: absolute; left: 50%; transform: translateX(-50%);
  bottom: calc(env(safe-area-inset-bottom, 0px) + ${DOCK_BOTTOM}px);
  display: flex; gap: 6px; padding: 6px; border-radius: 999px; pointer-events: auto; }
.dr-btn { pointer-events: auto; border: 0; padding: 0; margin: 0; color: inherit; position: relative;
  display: grid; place-items: center; cursor: pointer; outline: none; touch-action: manipulation;
  width: 44px; height: 44px; border-radius: 50%; background: transparent;
  transition: transform 160ms ease-out, background 200ms ${EASE}; }
.dr-btn:hover { background: rgb(255 255 255 / .08); }
.dr-btn:active { transform: scale(0.94); }
.dr-btn:focus-visible { box-shadow: 0 0 0 2px ${ACCENT}; }
.dr-btn.on { color: ${ACCENT}; background: rgb(244 217 104 / .14); }
.dr-btn .dr-mark { position: absolute; bottom: 3px; right: 3px; width: 15px; height: 15px;
  border-radius: 50%; background: ${ACCENT}; color: #232528; display: grid; place-items: center;
  font: 700 9px/1 system-ui, -apple-system, sans-serif; }
.dr-tip { position: absolute; bottom: calc(100% + 12px); left: 50%; transform: translate(-50%, 4px);
  padding: 6px 10px; border-radius: 10px; white-space: nowrap; opacity: 0; pointer-events: none;
  font: 600 12px/1 system-ui, -apple-system, sans-serif;
  transition: opacity 220ms ${EASE}, transform 220ms ${EASE}; }
.dr-tip.show { opacity: 1; transform: translate(-50%, 0); }
@media (hover: hover) { .dr-btn:hover .dr-tip { opacity: 1; transform: translate(-50%, 0); } }
.dr-dock-line { position: absolute; left: 18px; right: 18px; top: -1px; height: 2px; border-radius: 2px;
  background: rgb(255 255 255 / .12); overflow: hidden; }
.dr-dock-line > div { height: 100%; background: ${ACCENT}; transform-origin: 0 50%;
  transform: scaleX(0); box-shadow: 0 0 8px ${ACCENT}; }
.dr-cam { position: absolute; pointer-events: auto; border: 0; padding: 0; margin: 0;
  background: transparent; cursor: pointer; border-radius: 16px; outline: none; }
.dr-cam:focus-visible { box-shadow: 0 0 0 2px ${ACCENT}; }
.dr-card { position: absolute; pointer-events: auto; border-radius: 18px; padding: 10px;
  display: flex; flex-direction: column; gap: 6px; animation: dr-in 260ms ${EASE} both; }
@keyframes dr-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
.dr-row { display: flex; align-items: center; gap: 8px; }
.dr-row .dr-title { flex: 1; font: 600 14px/1.2 system-ui, -apple-system, sans-serif; padding-left: 4px;
  white-space: nowrap; }
.dr-small { pointer-events: auto; border: 1px solid rgb(235 246 253 / .22); background: rgb(255 255 255 / .08);
  color: #fff; border-radius: 999px; height: 32px; padding: 0 12px; cursor: pointer;
  font: 600 12px/1 system-ui, -apple-system, sans-serif; transition: transform 160ms ease-out; }
.dr-small:active { transform: scale(0.95); }
.dr-small.play { background: ${ACCENT}; color: #232528; border-color: transparent; }
.dr-small.on { box-shadow: inset 0 0 0 1.5px ${ACCENT}; }
.dr-best { display: flex; gap: 1px; margin-right: 2px; }
.dr-stars { position: absolute; left: 50%; transform: translateX(-50%); pointer-events: auto;
  display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-radius: 22px;
  animation: dr-pop 420ms ${EASE} both; }
@keyframes dr-pop { from { opacity: 0; transform: translate(-50%, 10px) scale(.92); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
.dr-icon { pointer-events: auto; width: 40px; height: 40px; border-radius: 50%; border: 0;
  background: rgb(255 255 255 / .1); color: #fff; display: grid; place-items: center; cursor: pointer;
  transition: transform 160ms ease-out; }
.dr-icon:active { transform: scale(0.94); }
.dr-show { position: absolute; right: ${GUTTER}px; top: ${GUTTER}px; }
.dr-gone { opacity: 0; pointer-events: none; }
.dr-howto-back { position: absolute; inset: 0; pointer-events: auto; background: rgb(10 10 14 / .25);
  animation: dr-fade 260ms ${EASE} both; }
@keyframes dr-fade { from { opacity: 0; } to { opacity: 1; } }
.dr-howto { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  padding: 16px 18px; border-radius: 22px; display: flex; flex-direction: column; gap: 12px;
  width: min(340px, calc(100% - 32px)); animation: dr-pop2 360ms ${EASE} both; }
@keyframes dr-pop2 { from { opacity: 0; transform: translate(-50%, -46%) scale(.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
.dr-step { display: flex; align-items: center; gap: 14px; font: 600 15px/1.25 system-ui, -apple-system, sans-serif; }
.dr-step .dr-pic { flex: none; width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center;
  background: rgb(255 255 255 / .08); color: #fff; }
.dr-step .dr-num { color: ${ACCENT}; font-weight: 700; margin-right: 2px; }
@media (prefers-reduced-motion: reduce) { .dr-card, .dr-stars, .dr-howto, .dr-howto-back { animation: none; } }
`;

const Icon = ({
  children,
  size = 20,
}: {
  children: ReactNode;
  size?: number;
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
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

const HAND_PATH =
  "M8 13V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5V4.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.3 14.6a1.6 1.6 0 0 1 2.4-2.1L8 14";

const CameraIcon = () => (
  <Icon>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
);
const HandIcon = ({ on }: { on: boolean }) => (
  <Icon>
    <path
      d={HAND_PATH}
      fill={on ? "currentColor" : "none"}
      fillOpacity={on ? 0.25 : 0}
    />
    {on ? null : <path d="M3.5 3.5l17 17" />}
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
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
  </Icon>
);
const HelpIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6" />
    <circle cx="12" cy="17" r=".6" fill="currentColor" />
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

// ---------------------------------------------------------------- how to play

/** A step picture: a 24 grid drawn large, with a lighter line. */
const Pic = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width={40}
    height={40}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** Two open hands up inside the camera frame. */
const PicHands = () => (
  <Pic>
    <rect x="1.5" y="3.5" width="21" height="17" rx="3" opacity=".5" />
    {[false, true].map((flip) => (
      <path
        key={String(flip)}
        transform={flip ? "translate(24 0) scale(-1 1)" : undefined}
        d="M10.5 17.5H8.2a2.2 2.2 0 0 1-2-1.3L4.6 13a.9.9 0 0 1 1.5-.9l1.2 1.3V8.3a.8.8 0 0 1 1.6 0v3V7a.8.8 0 0 1 1.6 0v4.3"
      />
    ))}
    <path
      d="M10.5 17.5v-6.2a.8.8 0 0 1 1.5 0M13.5 17.5v-6.2a.8.8 0 0 0-1.5 0"
      opacity=".9"
    />
  </Pic>
);
/** A closed fist, knuckles up. */
const PicFist = () => (
  <Pic>
    <path d="M5.5 11a2 2 0 0 1 2-2h8.5a2.5 2.5 0 0 1 2.5 2.5v3.5a5.5 5.5 0 0 1-5.5 5.5h-2a5.5 5.5 0 0 1-5.5-5.5z" />
    <path d="M9.5 9v3M12.5 9v3M15.5 9.1v2.9" />
    <path d="M5.5 13h5a1.6 1.6 0 0 1 0 3.2H9" />
  </Pic>
);
/** A stick coming down onto a drum. */
const PicStrike = () => (
  <Pic>
    <ellipse cx="12" cy="17" rx="8.5" ry="2.8" />
    <path d="M3.5 17v2c0 1.5 3.8 2.8 8.5 2.8s8.5-1.3 8.5-2.8v-2" opacity=".5" />
    <path d="M19 2.5l-6.2 12.8" strokeWidth={2} />
    <path d="M6.5 4v6.5M4.3 8.3l2.2 2.2 2.2-2.2" />
  </Pic>
);
/** A nod of the head, or the bass drum, for the kick. */
const PicKick = () => (
  <Pic>
    <circle cx="7.5" cy="7.5" r="3.5" />
    <path d="M2 20c0-3.6 2.5-6.2 5.5-6.2S13 16.4 13 20" />
    <path d="M12.6 3.6a5.5 5.5 0 0 1 .3 6.4M11.4 9.7l1.5.6.5-1.6" />
    <circle cx="18.5" cy="16" r="4.2" opacity=".75" />
    <circle
      cx="18.5"
      cy="16"
      r="1.4"
      fill="currentColor"
      stroke="none"
      opacity=".75"
    />
  </Pic>
);

const STEPS: { pic: ReactNode; text: string }[] = [
  { pic: <PicHands />, text: "Show both hands" },
  { pic: <PicFist />, text: "Make fists" },
  { pic: <PicStrike />, text: "Strike down at a drum" },
  { pic: <PicKick />, text: "Nod or tap for the kick" },
];

// ---------------------------------------------------------------- the dock

const VIEW_MARK: Record<View, string> = { drummer: "1", front: "2", top: "3" };
const VIEW_LABEL: Record<View, string> = {
  drummer: "View: Drummer",
  front: "View: Front",
  top: "View: Top",
};

/** The stars stay up this long after a song (ms). */
const STARS_FOR = 5000;

type DockButton = {
  id: string;
  label: string;
  icon: ReactNode;
  on?: boolean;
  mark?: string;
  act: () => void;
};

export const Hud = () => {
  useDrumsVersion();
  const [, tick] = useState(0);
  const [tapped, setTapped] = useState<string | null>(null);
  const tapTimer = useRef(0);
  const finishedAt = drums.finish?.at ?? null;
  useEffect(() => {
    if (finishedAt === null) return undefined;
    const t = window.setTimeout(() => tick((n) => n + 1), STARS_FOR);
    return () => window.clearTimeout(t);
  }, [finishedAt]);
  useEffect(() => () => window.clearTimeout(tapTimer.current), []);
  const showStars =
    drums.finish !== null && performance.now() - drums.finish.at < STARS_FOR;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const frame = frameRect(width, height);
  const tall = height > width;
  const best = drums.songCard ? bestStars() : {};
  const hidden = drums.camHidden;

  const buttons: DockButton[] = [
    drums.session
      ? {
          id: "songs",
          label: "Stop",
          icon: <StopIcon />,
          on: true,
          act: stopSong,
        }
      : {
          id: "songs",
          label: "Songs",
          icon: <NoteIcon />,
          on: drums.songCard,
          act: () => {
            drums.songCard = !drums.songCard;
            drums.howTo = false;
            drums.changed();
          },
        },
    {
      id: "hands",
      label: drums.handsOn ? "Hands on" : "Hands off",
      icon: <HandIcon on={drums.handsOn} />,
      on: drums.handsOn,
      act: toggleHands,
    },
    {
      id: "view",
      label: VIEW_LABEL[drums.view],
      icon: <ViewIcon />,
      mark: VIEW_MARK[drums.view],
      act: nextView,
    },
    {
      id: "light",
      label: drums.night ? "Night" : "Day",
      icon: drums.night ? <MoonIcon /> : <SunIcon />,
      act: () => setNight(!drums.night),
    },
    {
      id: "howto",
      label: "How to play",
      icon: <HelpIcon />,
      on: drums.howTo,
      act: () => {
        drums.howTo = !drums.howTo;
        drums.songCard = false;
        drums.changed();
      },
    },
  ];

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

        {drums.howTo ? (
          <div
            className="dr-howto-back"
            data-hud="howto"
            role="presentation"
            onPointerDown={() => {
              drums.howTo = false;
              drums.changed();
            }}
          >
            <div
              className="dr-howto dr-glass"
              role="dialog"
              aria-label="How to play"
            >
              {STEPS.map((st, i) => (
                <div className="dr-step" key={st.text}>
                  <span className="dr-pic">{st.pic}</span>
                  <span>
                    <span className="dr-num">{i + 1}</span> {st.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {drums.songCard && !drums.session ? (
          <div
            className="dr-card dr-glass"
            data-hud="song-card"
            // Above the dock; on a tall screen, up in the room clear of the kit.
            style={{
              left: "50%",
              transform: "translateX(-50%)",
              ...(tall
                ? {
                    top: frame.top + frame.height + 12,
                    width: "calc(100% - 32px)",
                    maxWidth: 380,
                  }
                : {
                    bottom: `calc(env(safe-area-inset-bottom, 0px) + ${DOCK_BOTTOM + DOCK_HEIGHT + 12}px)`,
                    minWidth: 320,
                  }),
            }}
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
            className="dr-stars dr-glass"
            style={{ top: tall ? frame.top + frame.height + 24 : "16%" }}
          >
            <span
              className="dr-row"
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

        <div className="dr-dock dr-glass" data-hud="dock">
          {drums.session ? (
            <div className="dr-dock-line" aria-hidden="true">
              <div
                ref={(el) => {
                  progressLine.el = el;
                }}
              />
            </div>
          ) : null}
          {buttons.map((b) => {
            const showTip = tapped === b.id;
            return (
              <button
                key={b.id}
                type="button"
                data-hud={b.id}
                className={`dr-btn ${b.on ? "on" : ""}`}
                aria-label={b.label}
                aria-pressed={b.on}
                onPointerUp={(e) => {
                  // On touch the label shows for a moment after the tap.
                  if (e.pointerType === "mouse") return;
                  setTapped(b.id);
                  window.clearTimeout(tapTimer.current);
                  tapTimer.current = window.setTimeout(
                    () => setTapped(null),
                    TAP_LABEL,
                  );
                }}
                onClick={b.act}
              >
                {b.icon}
                {b.mark ? <span className="dr-mark">{b.mark}</span> : null}
                <span className={`dr-tip dr-glass ${showTip ? "show" : ""}`}>
                  {b.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Html>
  );
};
