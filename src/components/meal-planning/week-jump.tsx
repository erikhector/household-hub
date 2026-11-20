"use client";

// GAP-85: the planner's week range, as a button that opens a native date
// field. Picking any date shows the week containing it, so the Christmas
// dinner can go on the plan in November without tapping "Next week" five
// times (a full page load each). Navigation is the same `?week=` URL the
// arrows use; the page reads the week from it, so there's no client state
// to keep in step. "This week" in PeriodSwitcher stays the way back.
//
// A native date field, not a calendar of our own: it's the platform's
// picker on phones (M4, pick don't type), it's keyboard- and screen-reader-
// accessible for free, and it costs no bundle.

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { weekKeyForPickedDate } from "@/app/dashboard/meal-planning/date-utils";

// Keys that move focus (out of the field, or between its day, month and
// year) or are only held down with another: none of them edits the date.
const MOVE_KEYS = new Set(["Tab", "ArrowLeft", "ArrowRight", "Shift", "Control", "Meta", "Alt"]);

export function WeekJump({
  label,
  weekStartKey,
  dict,
}: {
  /** The week range, already formatted in the viewer's locale. */
  label: string;
  weekStartKey: string;
  dict: { chooseWeek: string; chooseWeekDate: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fieldId = useId();

  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // On a touch screen, straight to the platform's picker, so a phone user
    // taps once, not twice. The tap that opened the field still counts as
    // the user activation showPicker needs; where it's unsupported or
    // refused the focused field is still there to tap. Not with a mouse and
    // keyboard: there the focused field takes typing at once, and an open
    // popup would swallow the Escape that closes the field.
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    try {
      input.showPicker();
    } catch {
      // Unsupported (older Safari) or no user activation: the field stays.
    }
  }, [open]);

  // A picked date goes at once, but a typed one waits for Enter (or for
  // focus leaving the field). The field starts on a whole date, so desktop
  // Chrome fires a change for every segment typed or arrowed: going on the
  // first one jumped to January while the user was still typing the "2" of
  // "12", and closed the field under them. A change with no editing key
  // before it is the platform's picker (or the popup calendar), which is
  // one deliberate choice.
  const typedRef = useRef(false);

  function close() {
    // Escape discards a half-typed date, so the blur it causes doesn't go.
    typedRef.current = false;
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onChange(value: string) {
    if (typedRef.current) return;
    go(value);
  }

  function go(value: string) {
    const key = weekKeyForPickedDate(value);
    if (!key) return;
    typedRef.current = false;
    setOpen(false);
    if (key === weekStartKey) return;
    // In a transition, so the button shows it's working until the new week
    // has rendered (M5).
    startTransition(() => router.push(`/dashboard/meal-planning?week=${key}`));
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* The range is the visible text and stays the headline (UX-149: it
          wraps rather than truncating); "Choose week" leads the accessible
          name so a screen reader hears what the button does, and the range
          is still in the name (WCAG 2.5.3, label in name). */}
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={open ? fieldId : undefined}
        disabled={pending}
        onClick={() => setOpen((was) => !was)}
        // h-auto on phones too: the button's fixed 44 px height would leave
        // a range wrapped onto three lines at 200% text spilling over the
        // bar above and the day cards below. min-h-11 keeps M3's target.
        className="h-auto min-h-11 gap-2 whitespace-normal px-2 py-1 text-center font-heading text-lg font-semibold text-balance max-sm:h-auto pointer-coarse:h-auto"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
        )}
        <span className="sr-only">{dict.chooseWeek}: </span>
        <span>{label}</span>
      </Button>
      {open && (
        <div className="flex flex-col items-center gap-1.5">
          <Label htmlFor={fieldId}>{dict.chooseWeekDate}</Label>
          <Input
            ref={inputRef}
            id={fieldId}
            type="date"
            defaultValue={weekStartKey}
            autoComplete="off"
            enterKeyHint="go"
            className="w-auto"
            onChange={(event) => onChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              } else if (event.key === "Enter") {
                event.preventDefault();
                go(event.currentTarget.value);
              } else if (!MOVE_KEYS.has(event.key) && !event.altKey) {
                // Alt+ArrowDown opens the popup calendar: a pick, not typing.
                typedRef.current = true;
              }
            }}
            onBlur={(event) => {
              // Tabbing or clicking away goes to what was typed, the same as
              // Enter. Not when focus moves to the "Choose week" button: that
              // click closes the field, and going too would reopen it on the
              // new week.
              if (!typedRef.current || event.relatedTarget === buttonRef.current) {
                typedRef.current = false;
                return;
              }
              go(event.currentTarget.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
