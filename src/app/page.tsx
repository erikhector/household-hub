import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Household Hub</h1>
      <p className="max-w-md text-muted-foreground">
        Track what&apos;s in your pantry, plan meals, auto-generate shopping
        lists, and keep your household budget in one place.
      </p>
      <div className="flex gap-3">
        <Button render={<Link href="/signup">Get started</Link>} />
        <Button variant="outline" render={<Link href="/login">Log in</Link>} />
      </div>
    </div>
  );
}
