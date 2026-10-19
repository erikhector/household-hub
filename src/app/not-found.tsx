import Link from "next/link";
import { Compass } from "lucide-react";
import { StatusCard, StatusCardLink } from "@/components/auth/status-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/get-dictionary";

// UX-65: a Server Component so it can tell who is looking. "Back to
// dashboard" sends a logged-out stranger to the login form, so they get the
// token pages' StatusCard (brand mark, icon, title) with a way to the landing
// page instead. A signed-in user keeps the in-app card and the way back to
// their dashboard.
export default async function NotFound() {
  const [session, dict] = await Promise.all([auth(), getDictionary()]);
  const copy = dict.notFound;

  if (!session?.user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
        <StatusCard brand={dict.auth.brand} icon={Compass} tone="neutral" title={copy.title}>
          <p className="text-sm text-muted-foreground">{copy.body}</p>
          <StatusCardLink href="/">{copy.goToSquirrel}</StatusCardLink>
        </StatusCard>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Compass className="size-5 shrink-0 text-primary" />
            {copy.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{copy.body}</p>
          <Button type="button" render={<Link href="/dashboard" />}>
            {copy.backToDashboard}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
