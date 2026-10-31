// The motion curves of a hit (pure): how a drum dips, a stick whacks and
// rebounds, a cymbal wobbles. Times in seconds since the hit; everything is
// strict ease-out except the physical wobble and the stick's rebound.

export const easeOut = (t: number) =>
  1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** A drum dips (0 → 1) quickly and settles back over this long (s). */
export const DIP = { down: 0.025, back: 0.18 };

/** The drum's dip, 0..1: down fast, back slowly, never past its rest. */
export const dip = (t: number) => {
  if (t < 0 || t > DIP.down + DIP.back) return 0;
  if (t < DIP.down) return easeOut(t / DIP.down);
  return 1 - easeOut((t - DIP.down) / DIP.back);
};

/** The stick's whack: on the head, then a rebound above its rest, then rest. */
export const WHACK = { hold: 0.035, up: 0.085, settle: 0.23 };

/**
 * The stroke (1 = tip on the head, 0 = resting, below 0 = bounced up) after
 * contact. A harder hit (`v` 0..1) rebounds higher.
 */
export const whack = (t: number, v: number) => {
  const rebound = 0.15 + 0.2 * v;
  if (t < 0) return 0;
  if (t < WHACK.hold) return 1;
  let e = t - WHACK.hold;
  if (e < WHACK.up) return 1 - (1 + rebound) * easeOut(e / WHACK.up);
  e -= WHACK.up;
  if (e < WHACK.settle) return -rebound * (1 - easeOut(e / WHACK.settle));
  return 0;
};

/** How long a whack lasts (s). */
export const WHACK_LENGTH = WHACK.hold + WHACK.up + WHACK.settle;

/** A damped wobble: a sway that dies away (`tau` s) at `freq` Hz. */
export const wobble = (t: number, tau: number, freq: number) =>
  t < 0 ? 0 : Math.exp(-t / tau) * Math.sin(2 * Math.PI * freq * t);

/** A cymbal's wobble lasts until it has died to 1 % (s). */
export const wobbleLength = (tau: number) => tau * Math.log(100);

/** A short pulse 0 → 1 → 0 over `length` s (ease-out each way). */
export const pulse = (t: number, length: number) => {
  if (t < 0 || t > length) return 0;
  const half = length * 0.3;
  return t < half
    ? easeOut(t / half)
    : 1 - easeOut((t - half) / (length - half));
};
