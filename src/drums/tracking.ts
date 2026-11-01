// The camera and hand tracking settings, as an SDK tracking config: the
// camera's whole picture (no zoom), so hands near its edges stay in view,
// and 30 hand readings a second, since strokes are quick.
import { resolveTrackingConfig, toTrackerProps } from "@vincentt-xr/sdk";

/** The camera's settings (the provider takes them before the scene loads). */
export const CAMERA_PERF = { cameraZoom: 1 };

let hand: ReturnType<typeof toTrackerProps<"hand">> | null = null;

/** The hand tracker's props, from the tracking config. */
export const handTracking = () => {
  hand ??= toTrackerProps(
    resolveTrackingConfig({
      perf: CAMERA_PERF,
      trackers: { hand: { enabled: true, targetFps: 30 } },
    }),
    "hand",
  );
  return hand;
};
