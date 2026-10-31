// The One Euro filter: smooths a reading a lot while it is still and hardly
// at all while it moves fast, so a held stick is steady and a swung one
// doesn't trail behind the hand.

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  value = 0;

  ready = false;

  private speed = 0;

  private t = 0;

  constructor(
    private readonly opts: {
      minCutoff: number;
      beta: number;
      dCutoff?: number;
    },
  ) {}

  reset() {
    this.ready = false;
    this.speed = 0;
  }

  /** A new reading at time `t` (s); returns the filtered value. */
  filter(x: number, t: number) {
    if (!this.ready || t <= this.t) {
      if (!this.ready) {
        this.value = x;
        this.speed = 0;
        this.ready = true;
      }
      this.t = t;
      return this.value;
    }
    const dt = Math.min(0.5, t - this.t);
    this.t = t;
    const d = (x - this.value) / dt;
    this.speed += (d - this.speed) * alpha(this.opts.dCutoff ?? 1, dt);
    const cutoff = this.opts.minCutoff + this.opts.beta * Math.abs(this.speed);
    this.value += (x - this.value) * alpha(cutoff, dt);
    return this.value;
  }
}
