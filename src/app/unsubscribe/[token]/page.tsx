import { DigestUnsubscribeClient } from "@/components/auth/digest-unsubscribe-client";
import { LegalFooter } from "@/components/legal-footer";
import { getDictionary } from "@/lib/i18n/get-dictionary";

// GAP-27: public (outside /dashboard, so src/proxy.ts never asks for a
// login) landing page for the weekly digest's unsubscribe link. Nothing is
// written during render — see DigestUnsubscribeClient for why the actual
// opt-out goes through an auto-submitted Server Action, the same reasoning
// as /verify-email/[token].
export default async function DigestUnsubscribePage(props: PageProps<"/unsubscribe/[token]">) {
  const [{ token }, dict] = await Promise.all([props.params, getDictionary()]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <DigestUnsubscribeClient token={token} brand={dict.auth.brand} dict={dict.digestUnsubscribe} />
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
