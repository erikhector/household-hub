import { describe, expect, it } from "vitest";
import { exitWhenIntroDone, startExitNow, type SplashAnimation } from "./pwa-splash";

function animation(animationName: string, currentTime: number, delay = 0, finished: Promise<unknown> = Promise.resolve()) {
  return {
    animationName,
    currentTime,
    finished,
    effect: { getTiming: () => ({ delay }) },
  } satisfies SplashAnimation;
}

describe("startExitNow", () => {
  it("jumps an exit animation that is still waiting out its delay to its start", () => {
    const exit = animation("pwa-splash-exit-iris", 700, 1400);
    startExitNow([exit]);
    expect(exit.currentTime).toBe(1400);
  });

  it("leaves an exit animation that has already started alone", () => {
    const exit = animation("pwa-splash-exit-iris", 1500, 1400);
    startExitNow([exit]);
    expect(exit.currentTime).toBe(1500);
  });

  it("never touches intro or unrelated animations", () => {
    const intro = animation("pwa-splash-intro-hop", 100, 0);
    const other = animation("vt-fade-in", 0, 500);
    startExitNow([intro, other]);
    expect(intro.currentTime).toBe(100);
    expect(other.currentTime).toBe(0);
  });
});

describe("exitWhenIntroDone", () => {
  it("waits for the intro before starting the exit", async () => {
    let finishIntro!: () => void;
    const intro = animation("pwa-splash-intro-hop", 0, 0, new Promise<void>((resolve) => (finishIntro = resolve)));
    const exit = animation("pwa-splash-exit-iris", 200, 1400);
    const done = exitWhenIntroDone([intro, exit]);

    await Promise.resolve();
    expect(exit.currentTime).toBe(200);

    finishIntro();
    await done;
    expect(exit.currentTime).toBe(1400);
  });

  it("still starts the exit when an intro animation is cancelled", async () => {
    const intro = animation("pwa-splash-intro-rise", 0, 0, Promise.reject(new DOMException("cancelled", "AbortError")));
    const exit = animation("pwa-splash-exit-iris", 0, 1400);
    await exitWhenIntroDone([intro, exit]);
    expect(exit.currentTime).toBe(1400);
  });
});
