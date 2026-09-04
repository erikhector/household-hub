import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "@/components/auth/signup-form";
import { getDictionary } from "@/lib/i18n/get-dictionary";

export default async function SignupPage() {
  const dict = await getDictionary();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Link
        href="/"
        className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight"
      >
        <span className="flex size-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Sparkles className="size-4" />
        </span>
        {dict.auth.brand}
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{dict.auth.signup.pageTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupForm dict={dict.auth.signup} />
        </CardContent>
      </Card>
    </div>
  );
}
