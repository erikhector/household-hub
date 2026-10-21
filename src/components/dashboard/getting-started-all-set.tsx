"use client";

// UX-69: the finish moment. The server decides whether it is due (every step
// done, and the done cookie not yet set) and renders this with `show`. The
// component then holds on to that decision in state: it records the cookie
// once, and because the state survives the re-render that follows, the
// message stays until the person closes it or leaves the overview, instead
// of vanishing the instant the cookie makes `show` false. The next visit
// finds the cookie and renders nothing.
//
// The entrance animation is `motion-safe:` only, so under
// prefers-reduced-motion the message simply appears (DESIGN.md: motion is
// never the only signal).

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MascotMark } from "@/components/brand/mascot-empty-state";
import { markGettingStartedCelebratedAction } from "@/lib/actions/household";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function GettingStartedAllSet({
  show,
  dict,
}: {
  show: boolean;
  dict: Dictionary["dashboard"]["gettingStarted"]["allSet"];
}) {
  const [visible, setVisible] = useState(show);
  const [wasShown] = useState(show);

  useEffect(() => {
    if (wasShown) void markGettingStartedCelebratedAction();
  }, [wasShown]);

  if (!visible) return null;

  return (
    <Card className="border-2 border-primary/40 bg-primary/5 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500">
      <CardContent className="flex flex-col items-center gap-3 text-center">
        <MascotMark
          alt={dict.mascotAlt}
          className="motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500"
        />
        <div role="status" className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
          <p className="text-sm text-muted-foreground">{dict.body}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setVisible(false)}>
          {dict.close}
        </Button>
      </CardContent>
    </Card>
  );
}
