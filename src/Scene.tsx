// Scene.tsx — Drums: a full 3D drum kit in front of you, a drumstick in each
// hand. Free play.
import { lazy, Suspense } from "react";

import { DrumsScene } from "./drums/DrumsScene";

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
    <DrumsScene />
    {DevMediaSwitcher && DevDebug ? (
      <Suspense fallback={null}>
        <DevMediaSwitcher />
        <DevDebug />
      </Suspense>
    ) : null}
  </>
);
