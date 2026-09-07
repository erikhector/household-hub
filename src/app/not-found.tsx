"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getClientLocale } from "@/lib/i18n/client-locale";

const COPY = {
  en: {
    title: "Page not found",
    body: "The page you're looking for doesn't exist or may have moved.",
    backHome: "Back to dashboard",
  },
  sv: {
    title: "Sidan hittades inte",
    body: "Sidan du letar efter finns inte, eller har flyttats.",
    backHome: "Till översikten",
  },
} as const;

export default function NotFound() {
  // See error.tsx's comment: locale is read directly at render time rather
  // than via setState-in-effect, so the one-render server/client text
  // mismatch is expected and suppressed the same way.
  const copy = COPY[getClientLocale()];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl" suppressHydrationWarning>
            <Compass className="size-5 shrink-0 text-primary" />
            {copy.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {copy.body}
          </p>
          <Button type="button" render={<Link href="/dashboard" />} suppressHydrationWarning>
            {copy.backHome}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
