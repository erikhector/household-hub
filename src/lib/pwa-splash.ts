// The installed app's launch splash (PwaSplashScreen, `.pwa-splash-*` in
// globals.css) runs entirely on CSS so it plays before React loads. Its exit
// animations carry a fixed delay (the cap), so even with no JavaScript the
// splash always leaves. Once the app has hydrated, this skips that wait: as
// soon as the intro (the badge's hop, the wordmark rising) has finished, every
// exit animation that hasn't started yet jumps to its start, so the splash
// leaves as soon as the app can be used. A slow launch still ends at the cap.
//
// The CSS names its keyframes `pwa-splash-intro-*` and `pwa-splash-exit-*`,
// which is how the two groups are told apart here. Anything else is ignored.

const INTRO = "pwa-splash-intro-";
const EXIT = "pwa-splash-exit-";

/** The slice of a CSSAnimation this needs, so tests can pass plain objects. */
export type SplashAnimation = {
  /** Undefined on a CSSTransition, which getAnimations() lists beside the
   * CSSAnimations when anything in the subtree is mid-transition. */
  animationName?: string;
  currentTime: CSSNumberish | null;
  finished: Promise<unknown>;
  effect: { getTiming(): { delay?: number } } | null;
};

/** Starts every not-yet-started exit animation now. One already running (or
 * finished, because the cap passed first) is left alone: restarting it would
 * bring the splash back. */
export function startExitNow(animations: SplashAnimation[]) {
  for (const animation of animations) {
    if (!animation.animationName?.startsWith(EXIT)) continue;
    const delay = animation.effect?.getTiming().delay ?? 0;
    const current = Number(animation.currentTime ?? 0);
    if (current < delay) animation.currentTime = delay;
  }
}

/** Waits for the intro to finish, then starts the exit. A cancelled intro
 * animation (reduced motion turned on, the element hidden) counts as done. */
export async function exitWhenIntroDone(animations: SplashAnimation[]) {
  const intro = animations.filter((animation) => animation.animationName?.startsWith(INTRO));
  await Promise.all(intro.map((animation) => animation.finished.catch(() => undefined)));
  startExitNow(animations);
}
