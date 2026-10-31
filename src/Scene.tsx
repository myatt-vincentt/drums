// Scene.tsx — Drums: a full 3D drum kit in a recording studio, a drumstick in
// each hand. The scene's code loads on its own, after the home page shows.
import { lazy, Suspense } from "react";

const DrumsScene = lazy(async () => ({
  default: (await import("./drums/DrumsScene")).DrumsScene,
}));

// Dev-only helpers for previewing without a camera. Lazy and behind a
// constant esbuild folds to false in production. Two rules:
// `process.env.NODE_ENV`, not `import.meta.env.DEV` (vincentt-xr/v2-template#112);
// and write the check INSIDE the ternary — hoisted into a `const`, esbuild
// keeps the dead branch.
const DevMediaSwitcher =
  process.env.NODE_ENV !== "production"
    ? lazy(() => import("./DevMediaSwitcher"))
    : null;
const DevDebug =
  process.env.NODE_ENV !== "production"
    ? lazy(() => import("./drums/DevDebug"))
    : null;

export const Scene = () => (
  <>
    <Suspense fallback={null}>
      <DrumsScene />
    </Suspense>
    {DevMediaSwitcher && DevDebug ? (
      <Suspense fallback={null}>
        <DevMediaSwitcher />
        <DevDebug />
      </Suspense>
    ) : null}
  </>
);
