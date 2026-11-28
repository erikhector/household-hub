"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Loader2,
  Package,
  Share2,
  ShoppingCart,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MascotMark } from "@/components/brand/mascot-empty-state";
import { canNativeShare } from "@/components/ui/copy-link-button";
import { NAV_ICON_TILE_CLASSES, type NavColor } from "@/components/dashboard/nav-items";
import { format, plural, type PluralForms } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { WrappedCard, WrappedStats } from "@/lib/wrapped/wrapped-calc";

type WrappedDict = Dictionary["wrapped"];

// Squirrel Wrapped's story player: one full-screen card at a time, like a
// phone "story". Every way forward has a visible twin (M7): tapping the
// right or left half of the card, swiping, and the arrow keys all do what
// the Next and Back buttons at the bottom (the thumb zone, M2) do. Escape,
// Done and the close button go back to where the story was opened from. Under prefers-reduced-motion the
// card just changes, without the slide (motion-safe:, and globals.css
// collapses every animation anyway).

/** Sonner's toaster container, left out of the inert page behind the story. */
const TOASTER = "[data-react-aria-top-layer]";

/** How far a finger must travel sideways to count as a swipe, in px. */
const SWIPE_MIN_PX = 48;
/** The screen edges belong to the OS back gesture (M7), so a touch that
 * starts this close to one is left alone. */
const EDGE_GUARD_PX = 24;
/** Done takes Next's place on the last card, so the second tap of a quick
 * double tap on Next would land on it and close the story before the
 * household's squirrel was seen. Done ignores presses this soon after the
 * last card appears: longer than a double tap (Android and Windows count
 * taps up to ~300-500 ms apart as one), short enough that nobody reaching
 * for Done on purpose meets it. */
const DONE_GUARD_MS = 400;

const subscribeNever = () => () => {};
type ShareMode = "share" | "copy" | "none";
function detectShareMode(): ShareMode {
  if (canNativeShare()) return "share";
  return typeof navigator.clipboard?.writeText === "function" ? "copy" : "none";
}

function count(forms: PluralForms, n: number, numberFormat: Intl.NumberFormat) {
  return format(plural(n, forms), { count: numberFormat.format(n) });
}

/** The shared skeleton of a card: an icon tile or the mascot, a heading,
 * then the card's own lines. */
function CardBody({
  icon: Icon,
  color,
  mascotAlt,
  eyebrow,
  heading,
  children,
}: {
  icon?: LucideIcon;
  color?: NavColor;
  mascotAlt?: string;
  eyebrow?: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {mascotAlt ? (
        <MascotMark alt={mascotAlt} />
      ) : Icon ? (
        <span
          className={cn(
            "flex size-14 items-center justify-center rounded-2xl",
            color ? NAV_ICON_TILE_CLASSES[color] : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-7" aria-hidden />
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        {eyebrow && <p className="text-caption font-medium text-muted-foreground">{eyebrow}</p>}
        <h2 className="font-heading text-page-title font-semibold tracking-tight text-balance break-words">{heading}</h2>
      </div>
      <div className="flex flex-col items-center gap-2 text-body text-muted-foreground">{children}</div>
    </div>
  );
}

/** The card's key number, set as a `stat` (DESIGN.md: the key number is the
 * first thing seen), with its words after it. */
function Stat({ children }: { children: ReactNode }) {
  return <p className="font-heading text-stat leading-tight font-bold text-balance break-words text-foreground">{children}</p>;
}

function ShareButton({ text, dict }: { text: string; dict: WrappedDict["persona"] }) {
  // Detected after hydration (the server can't know), without a
  // set-state-in-effect: the server pass renders no button.
  const mode = useSyncExternalStore<ShareMode>(subscribeNever, detectShareMode, () => "none");
  const [pending, setPending] = useState(false);
  if (mode === "none") return null;

  async function share() {
    setPending(true);
    try {
      if (mode === "share") {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        toast.success(dict.copiedToast);
      }
    } catch (err) {
      // Closing the share sheet rejects with AbortError: a choice, not a failure.
      if (!(err instanceof DOMException && err.name === "AbortError")) toast.error(dict.shareFailedToast);
    } finally {
      setPending(false);
    }
  }

  return (
    // focusableWhenDisabled: a natively disabled button drops focus to
    // <body> while the share sheet or clipboard call is pending, out of the
    // story (M10). This keeps it focused and announced as disabled instead.
    <Button type="button" onClick={share} disabled={pending} focusableWhenDisabled className="gap-1.5">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
      {mode === "share" ? dict.share : dict.copy}
    </Button>
  );
}

export function WrappedStory({
  stats,
  cards,
  householdName,
  locale,
  dict,
}: {
  stats: WrappedStats;
  cards: WrappedCard[];
  householdName: string;
  locale: Locale;
  dict: WrappedDict;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  // Which way the last step went, so the new card slides in from that side.
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const backHadFocus = useRef(false);
  const closingRef = useRef(false);
  const lastCardShownAt = useRef(0);
  const last = cards.length - 1;

  // Next (Cache Components) keeps a page left behind alive in a hidden
  // <Activity>, state and all, and shows it again on the next visit, a
  // link's push included (node_modules/next/dist/docs/01-app/02-guides/
  // preserving-ui-state.md). Opening the story again should start a fresh
  // look back, not resume on the card it was closed on, so it's reset as
  // it's hidden: a layout-effect cleanup runs then, before the page is put
  // away, so the old card never flashes on the way back. The closing guard
  // is re-armed on show, since a closed story is hidden, not unmounted.
  useLayoutEffect(() => {
    closingRef.current = false;
    return () => {
      setIndex(0);
      setDirection("forward");
    };
  }, []);

  // Close, Done and Escape go back to wherever the story was opened from
  // (M7): pushing Home instead added a history entry, so the Back gesture
  // reopened the story, and someone who opened it from Inventory's More
  // menu landed on Home. The Navigation API's `canGoBack` only counts this
  // origin's entries, so it is false when the story was the first page
  // (a shared or typed URL); then, and in browsers without the API, Home
  // is the way out.
  //
  // Once only: a second press while the first is on its way (a double tap
  // on Close, Escape held down) would call router.back() twice and leave
  // the page the story was opened from as well.
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const nav = (window as Window & { navigation?: { canGoBack?: boolean } }).navigation;
    if (nav?.canGoBack) router.back();
    else router.push("/dashboard");
  }, [router]);

  const go = useCallback(
    (step: 1 | -1) => {
      // Stepping back onto the first card disables Back, and a disabled
      // button drops focus to <body>, out of the story (M10). Noted here,
      // while Back still has focus, and handed to Next once the card shows.
      if (step === -1 && document.activeElement === backRef.current) backHadFocus.current = true;
      setDirection(step === 1 ? "forward" : "back");
      setIndex((i) => Math.min(last, Math.max(0, i + step)));
    },
    [last],
  );

  // Stamped in a layout effect, as the last card commits, so a second tap
  // queued right behind the first already sees it.
  useLayoutEffect(() => {
    if (index === last) lastCardShownAt.current = performance.now();
  }, [index, last]);

  function done() {
    if (performance.now() - lastCardShownAt.current < DONE_GUARD_MS) return;
    close();
  }

  useEffect(() => {
    if (!backHadFocus.current) return;
    backHadFocus.current = false;
    if (index === 0) nextRef.current?.focus();
  }, [index]);

  // Arrow keys step, Escape leaves. On the window so they work wherever
  // focus is in the story; the story takes focus on open so a keyboard user
  // starts inside it. Keys from anywhere else are left alone: the command
  // palette (Ctrl+K) and the toaster sit outside the story, and keys
  // pressed there must not step or close the story behind them. <body>
  // counts as the story's: the rest of the page is inert while it's open,
  // and a focused control that goes away leaves focus there.
  useEffect(() => {
    storyRef.current?.focus({ preventScroll: true });
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as Node;
      if (target !== document.body && !storyRef.current?.contains(target)) return;
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "Escape") close();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, close]);

  // The story covers the screen but renders inside the dashboard shell, so
  // without this the sidebar, bottom bar and page behind it stay in the tab
  // order and the accessibility tree: Tab or a screen-reader swipe would
  // walk onto controls nobody can see (M10). While it's open, every element
  // beside the story's ancestors is made inert, all the way up to <body>,
  // and restored on close. The toaster is left alone so "Copied" is still
  // announced, and an element that was already inert stays inert.
  useEffect(() => {
    const story = storyRef.current;
    if (!story) return;
    const made: HTMLElement[] = [];
    for (let node: HTMLElement | null = story; node && node !== document.body; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
        // Sonner's <section> is always mounted (its toast list only appears
        // with a toast), and carries this attribute.
        if (sibling.matches(TOASTER) || sibling.querySelector(TOASTER)) continue;
        sibling.inert = true;
        made.push(sibling);
      }
    }
    return () => made.forEach((el) => (el.inert = false));
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const edge = event.clientX < EDGE_GUARD_PX || event.clientX > window.innerWidth - EDGE_GUARD_PX;
    pointerStart.current = edge ? null : { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || event.button !== 0) return;
    // A tap on a real control (Share) is that control's, not a step.
    if ((event.target as HTMLElement).closest("button, a")) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const rect = event.currentTarget.getBoundingClientRect();
      go(event.clientX - rect.left < rect.width / 2 ? -1 : 1);
    }
  }

  const numberFormat = new Intl.NumberFormat(locale);
  const n = (forms: PluralForms, value: number) => count(forms, value, numberFormat);
  const year = String(stats.year);

  const highlights = [
    stats.meals.cooked > 0 && n(dict.meals.cooked, stats.meals.cooked),
    stats.shopping.itemsBought > 0 && n(dict.shopping.items, stats.shopping.itemsBought),
    stats.tasks.completed > 0 && n(dict.tasks.completed, stats.tasks.completed),
    stats.calendar.events > 0 && n(dict.calendar.events, stats.calendar.events),
  ].filter((line): line is string => Boolean(line));
  const shareText = format(dict.persona.shareText, {
    year,
    persona: dict.persona.names[stats.persona],
    highlights: highlights.slice(0, 3).join(" · "),
  }).trim();

  function renderCard(card: WrappedCard) {
    switch (card.kind) {
      case "intro":
        return (
          <CardBody mascotAlt={dict.persona.mascotAlt} eyebrow={dict.intro.eyebrow} heading={format(dict.intro.heading, { year })}>
            <p className="text-balance">{format(dict.intro.body, { household: householdName })}</p>
          </CardBody>
        );
      case "shopping": {
        const { listsCompleted, itemsBought, topItem } = stats.shopping;
        return (
          <CardBody icon={ShoppingCart} color="chart-2" heading={dict.shopping.heading}>
            {itemsBought > 0 && <Stat>{n(dict.shopping.items, itemsBought)}</Stat>}
            {listsCompleted > 0 && <p>{n(dict.shopping.lists, listsCompleted)}</p>}
            {topItem && (
              <p className="break-words">
                {format(dict.shopping.top, { name: topItem.name, count: numberFormat.format(topItem.count) })}
              </p>
            )}
          </CardBody>
        );
      }
      case "meals": {
        const { cooked, topRecipe } = stats.meals;
        return (
          <CardBody icon={ChefHat} color="chart-3" heading={dict.meals.heading}>
            <Stat>{n(dict.meals.cooked, cooked)}</Stat>
            {topRecipe && (
              <p className="break-words">
                {format(dict.meals.top, { name: topRecipe.name, count: numberFormat.format(topRecipe.count) })}
              </p>
            )}
          </CardBody>
        );
      }
      case "pantry":
        return (
          <CardBody icon={Package} color="chart-1" heading={dict.pantry.heading}>
            <Stat>{n(dict.pantry.restocks, stats.pantry.restocks)}</Stat>
            {stats.pantry.topRestocked && (
              <p className="break-words">{format(dict.pantry.top, { name: stats.pantry.topRestocked.name })}</p>
            )}
          </CardBody>
        );
      case "tasks":
        return (
          <CardBody icon={ListChecks} color="chart-5" heading={dict.tasks.heading}>
            <Stat>{n(dict.tasks.completed, stats.tasks.completed)}</Stat>
            <p className="text-balance">{dict.tasks.note}</p>
          </CardBody>
        );
      case "calendar":
        return (
          <CardBody icon={CalendarClock} color="chart-2" heading={dict.calendar.heading}>
            <Stat>{n(dict.calendar.events, stats.calendar.events)}</Stat>
          </CardBody>
        );
      case "busiest": {
        const month =
          stats.activity.busiestMonth === null
            ? null
            : new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
                new Date(Date.UTC(stats.year, stats.activity.busiestMonth, 1)),
              );
        return (
          <CardBody icon={TrendingUp} heading={dict.busiest.heading}>
            {/* The month as Intl writes it: capitalised in English, lower case
                in Swedish, where it sits mid-sentence. */}
            {month && <Stat>{format(dict.busiest.month, { month })}</Stat>}
            <p>{n(dict.busiest.activeDays, stats.activity.activeDays)}</p>
          </CardBody>
        );
      }
      case "money":
        // A plain count, no amount and no verdict (the money guardrail).
        return (
          <CardBody icon={Wallet} heading={dict.money.heading}>
            <Stat>{n(dict.money.transactions, stats.money.transactions)}</Stat>
            <p>{dict.money.note}</p>
          </CardBody>
        );
      case "persona":
        return (
          <CardBody mascotAlt={dict.persona.mascotAlt} eyebrow={dict.persona.heading} heading={dict.persona.names[stats.persona]}>
            <p className="text-balance">{dict.persona.descriptions[stats.persona]}</p>
            <div className="mt-2">
              <ShareButton text={shareText} dict={dict.persona} />
            </div>
          </CardBody>
        );
    }
  }

  const card = cards[index];
  const isLast = index === last;

  return (
    <div
      ref={storyRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={format(dict.storyLabel, { year })}
      className="fixed inset-0 z-50 flex flex-col gap-3 bg-background pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] outline-none [background:radial-gradient(circle,var(--gradient-start),var(--gradient-end))]"
    >
      <h1 className="sr-only">{dict.title}</h1>
      <div className="mx-auto flex w-full max-w-md items-center gap-3">
        {/* Progress: one segment per card, the seen ones filled. Screen
            readers hear "Card 2 of 9" at the top of each new card instead. */}
        <div className="flex flex-1 gap-1" aria-hidden>
          {cards.map((c, i) => (
            <span key={c.kind} className={cn("h-1 flex-1 rounded-full", i <= index ? "bg-primary" : "bg-foreground/15")} />
          ))}
        </div>
        <Button variant="ghost" size="icon" aria-label={dict.close} onClick={close}>
          <X className="size-5" aria-hidden />
        </Button>
      </div>

      <div
        className="mx-auto flex min-h-0 w-full max-w-md flex-1 touch-pan-y select-none"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (pointerStart.current = null)}
        // The live region sits here, on an element that stays mounted, not
        // on the keyed article: screen readers announce what changes inside
        // an existing live region but stay silent about one that is
        // inserted already filled, so each new card (with its "Card 2 of 9"
        // line) is read out after a Next press keeps focus on the button.
        aria-live="polite"
      >
        <article
          key={index}
          className={cn(
            // Centred while the card fits, top-aligned once it doesn't: a
            // plain justify-center pushes the top of a tall card (a phone on
            // its side, 200% text) above the scroll start, out of reach (M9).
            "flex w-full flex-col justify-center-safe overflow-y-auto rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10",
            "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
            direction === "forward" ? "motion-safe:slide-in-from-right-8" : "motion-safe:slide-in-from-left-8",
          )}
        >
          <p className="sr-only">{format(dict.progress, { current: index + 1, total: cards.length })}</p>
          {renderCard(card)}
        </article>
      </div>

      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
        <Button ref={backRef} variant="outline" onClick={() => go(-1)} disabled={index === 0} className="gap-1">
          <ChevronLeft className="size-4" aria-hidden />
          {dict.back}
        </Button>
        {isLast ? (
          <Button variant="outline" onClick={done}>
            {dict.done}
          </Button>
        ) : (
          <Button ref={nextRef} onClick={() => go(1)} className="gap-1">
            {dict.next}
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
