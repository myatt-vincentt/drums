# Drums

A full 3D drum kit in a recording studio, played with your hands. The studio fills the whole
screen: you sit behind the kit, and two see-through ghost hands holding drumsticks follow your
real hands. Strike down over a drum or a cymbal to hit it; nod (or tap) for the kick. The LED
strips flash the colour of what you hit. Your camera sits small in the top right corner.

- **Start:** the home page shows at once while the studio, the kit, the hands and the sounds load
  in the background; the Start button fills as they load. Start turns the sound on and asks for
  the camera (hand tracking starts only then). A short "how to play" card shows for 5 seconds,
  then the dock pulses once and the snare glows until your first hit.
- **Play by hand** (on by default): show both hands, make fists, strike down at a drum. A faster
  stroke hits harder. Rest a stick on the hi-hat to close it. Nod for the kick.
- **Play without hands:** tap or click a drum or cymbal; hold on the hi-hat to close it; Space
  plays the kick.
- **The dock** (bottom centre; a label shows on hover or for a moment after a tap): Songs (the
  song card; Stop while a song runs), Hands on / off, View (Drummer, Front, Top), Day / Night,
  and How to play. Tap the corner camera to tuck it away.
- **Learn and Play:** five songs and beats. Learn waits for each hit; Play keeps time and gives
  up to three stars (a slower speed is on the card). A ring lands on the next piece on the beat;
  the end brings confetti and a rainbow sweep on the LEDs. Best stars are kept for the visit.
- `?hands=off` starts with hand tracking off; the choice is kept for the visit.

## Files

```
src/drums/
  DrumsScene.tsx    the scene, loaded on its own after the home page shows
  Home.tsx          the home page (Start, loading, credit)
  Hud.tsx           the dock, the song card, the stars and the how-to-play card
  CameraRig.tsx     the views (drummer, front, top), fitted to the screen (layout.ts)
  Studio.tsx        the room, its baked light (day / night) and the kit's lights
  led.ts            the LED colour flash on hits (pure)
  Kit.tsx           the kit; kitMotion.ts: how it moves when hit
  GhostHands.tsx    the ghost hands and sticks (ghost.ts), aim (aim.ts) and strokes (hits.ts)
  hihat.ts          closing the hi-hat by holding still (pure)
  NodKick.tsx       the kick from a nod (nod.ts)
  PointerInput.tsx  taps, clicks and keys
  SongPlayer.tsx    Learn and Play (songs.ts, session.ts, synth.ts)
  Invite.tsx        the glow on the snare that invites the first hit
  Sparks.tsx        the flash where a stick lands hard
  CameraFrame.tsx   your camera in the corner
  audio.ts          the recorded kit, played with Web Audio
  state.ts          what the parts share
public/models/      the kit, the studio and its bakes, the ghost hands
public/sounds/      the drum samples (kit.json lists them)
```

- `src/App.tsx` uses a full-window container instead of the 9:16 frame, starts the camera on the
  home page's Start (at once when framed), and uses the home page in place of the loading screen;
  re-apply after a template upgrade.
- Dev preview without a camera: the media switcher starts on an SDK sample video. Tap the drums
  to play; `window.__drums` (dev only, `src/drums/DevDebug.tsx`) for the rest.

## Credits

Drum sounds: CrocellKit by the DrumGizmo team (CC BY 4.0). The 3D models, the studio and the code
are our own. Details in `CREDITS.md`.

---

# v2-template

The Vincentt starter app: a real React + R3F + Vincentt XR SDK (`@vincentt-xr/sdk`)
WebXR app, bundled by esbuild.

## Shape

```
src/
  main.tsx            mount — never edited
  App.tsx             protected shell: XRProvider + AspectRatioContainer +
                      XRScene + media-source binding, camera, lighting,
                      VideoBackground, PreviewAnchors — never edited
  Scene.tsx           the agent's surface: add SDK components and R3F
                      primitives here
  PreviewAnchors.tsx  editor-preview integration — never edited
```

See `AGENTS.md` and `GROUNDING.md` for the API reference and how to author scenes.

## Develop

```
pnpm install
pnpm dev          # esbuild dev server on localhost:5173 (output in .dev/)
pnpm preview      # on-device preview over a secure tunnel (needs `vincentt login`)
pnpm typecheck
pnpm build        # production bundle to dist/
```

## Release

`vincentt init` scaffolds from the **`latest` tag**, not from `main`. Merging to `main` does
not ship a template to creators — cutting a release does.

```
git tag 1.1.0 <sha>      # bare semver, no `v` prefix
git push origin 1.1.0    # the Release workflow verifies the tag, then moves `latest`
```

The Release workflow (`.github/workflows/release.yml`) installs from the frozen lockfile,
builds, and typechecks **the tagged tree** before force-updating `latest` to it. A tag that
fails leaves `latest` where it was, so a broken release cannot reach a new creator.

The job runs in the `release` environment, which accepts bare-semver tags only. To re-run it by
hand, dispatch it from the tag itself ("Use workflow from: 1.1.0"); a dispatch from `main` is
refused.

**Never move `latest` by hand.** It is force-updated by that workflow and nowhere else; moving
it manually decouples the pointer from the version it claims to be.

Creators can pin a specific version — `vincentt init --template 1.0.0` — which is the escape
hatch when a release turns out to be bad. That is why the version tags are immutable and only
`latest` moves.

### `MIGRATION.md` and the platform release row

Root `MIGRATION.md` carries one entry per released tag, newest first, authored in the same
PR as the change: `required: true|false`, a one-line summary, and optional notes bullets.
`required: false` means no consumer action is needed, never that the entry was skipped. The
Release workflow refuses to move `latest` for a tag with no valid entry, then — once `latest`
has moved — posts that entry as this release's row to the platform (`POST
/platform/releases`, component `template`), via `scripts/release-row.mjs`. Both steps read
`MIGRATION.md` from `main`, not from the tagged tree: the note is reviewed via PR into `main`
and is append-only per version, so `main`'s copy is the reviewed source for any tag, including
one cut before this file existed. That row is what `vincentt outdated` reads back to tell a
creator's agent what changed and what to do about it.
