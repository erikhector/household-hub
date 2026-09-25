"use client";

// Quiet-hours picker (GAP-14) shown inside PushNotificationsCard once this
// browser is subscribed. It edits only this browser's PushSubscription row
// (identified by its own push endpoint) — quiet hours are per device, so a
// phone can be silenced overnight while a laptop keeps buzzing. Suppression
// happens server-side in sendPushToHousehold (src/lib/push.ts); the in-app
// bell is never affected.

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clearPushQuietHoursAction, setPushQuietHoursAction } from "@/lib/actions/push";
import type { ActionState } from "@/lib/actions/auth";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// A sensible first suggestion for someone who's never set quiet hours:
// most people who want this want "not while I'm asleep".
const DEFAULT_START = "22";
const DEFAULT_END = "7";

const HOURS = Array.from({ length: 24 }, (_, h) => String(h));

// "07:00" rather than a locale-formatted "7 AM": the value is an hour on a
// 24-hour dial either way, and zero-padded 24-hour time reads the same in
// both supported locales without pulling Intl into every option.
function hourLabel(hour: string) {
  return `${hour.padStart(2, "0")}:00`;
}

// Captured at save time, not render time — this component only mounts after
// the card's effect has confirmed a subscription, so it never renders on the
// server, but reading it in the action keeps it fresh if the device changes
// zones while the page is open.
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

const initialState: ActionState = {};

export function PushQuietHoursForm({
  endpoint,
  quietHoursStart,
  quietHoursEnd,
  dict,
}: {
  endpoint: string;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  dict: Dictionary["profile"]["pushNotifications"]["quietHours"];
}) {
  const active = quietHoursStart !== null && quietHoursEnd !== null;
  const [start, setStart] = useState(active ? String(quietHoursStart) : DEFAULT_START);
  const [end, setEnd] = useState(active ? String(quietHoursEnd) : DEFAULT_END);
  const [clearing, startClearing] = useTransition();

  const [state, formAction, saving] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ): Promise<ActionState> => {
    formData.set("timeZone", browserTimeZone());
    const result = await setPushQuietHoursAction(prevState, formData);
    if (result.error) return { error: result.error };
    toast.success(dict.saved);
    return {};
  }, initialState);

  function handleClear() {
    startClearing(async () => {
      try {
        await clearPushQuietHoursAction(endpoint);
        setStart(DEFAULT_START);
        setEnd(DEFAULT_END);
        toast.success(dict.cleared);
      } catch {
        toast.error(dict.error);
      }
    });
  }

  const sameHours = start === end;
  const pending = saving || clearing;

  return (
    <form action={formAction} className="flex flex-col gap-3 border-t pt-3">
      <div>
        <h3 className="text-sm font-medium">{dict.title}</h3>
        <p className="text-sm text-muted-foreground">
          {active
            ? format(dict.activeDescription, { start: hourLabel(String(quietHoursStart)), end: hourLabel(String(quietHoursEnd)) })
            : dict.description}
        </p>
      </div>
      <input type="hidden" name="endpoint" value={endpoint} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="quiet-hours-start">{dict.startLabel}</Label>
          <Select name="quietHoursStart" value={start} onValueChange={(v) => v !== null && setStart(v)}>
            <SelectTrigger id="quiet-hours-start" className="w-28">
              <SelectValue>{(v: string) => hourLabel(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={h}>
                  {hourLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="quiet-hours-end">{dict.endLabel}</Label>
          <Select name="quietHoursEnd" value={end} onValueChange={(v) => v !== null && setEnd(v)}>
            <SelectTrigger id="quiet-hours-end" className="w-28">
              <SelectValue>{(v: string) => hourLabel(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={h}>
                  {hourLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {/* Equal hours would mean "never quiet" to the server, so it's
          blocked here with an explanation rather than saved as a schedule
          that never takes effect (the action rejects it too). */}
      {sameHours && <p className="text-sm text-muted-foreground">{dict.sameHours}</p>}
      {state.error && <p className="text-sm text-destructive">{dict.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || sameHours}>
          {saving ? dict.saving : dict.save}
        </Button>
        {active && (
          <Button type="button" variant="outline" size="sm" onClick={handleClear} disabled={pending}>
            {dict.clear}
          </Button>
        )}
      </div>
    </form>
  );
}
