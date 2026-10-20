import { cache } from "react";
import type { Metadata } from "next";
import { XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getShoppingListByShareToken } from "@/app/share/shopping-list/actions";
import { SharedShoppingListClient } from "@/components/shopping/shared-shopping-list-client";
import { StatusCard, StatusCardLink } from "@/components/auth/status-card";
import { LegalFooter } from "@/components/legal-footer";
import { UnitsProvider } from "@/components/units-provider";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { buildMetadata } from "@/lib/page-metadata";

// UX-64: the lookup is rate limited per token, so generateMetadata and the page
// must share one call per request (cache()) or each load would count twice.
const loadList = cache(getShoppingListByShareToken);

export async function generateMetadata(
  props: PageProps<"/share/shopping-list/[token]">,
): Promise<Metadata> {
  const { token } = await props.params;
  const [list, dict] = await Promise.all([loadList(token), getDictionary()]);
  if (!list) {
    return buildMetadata({
      title: dict.sharedShoppingList.notFoundTitle,
      description: dict.meta.fallbackDescription,
    });
  }
  return buildMetadata({ title: list.name, description: dict.meta.shareDescription });
}

// Top-level, NOT under /dashboard — reached only via a
// ShoppingListShareLink token, no session required at all (see
// src/app/share/shopping-list/actions.ts's top comment). Mirrors
// src/app/join/[token]/page.tsx's shape: a minimal standalone Card, no
// dashboard sidebar/nav chrome, composed directly against the root layout.
// src/proxy.ts's auth gate only matches paths starting with "/dashboard",
// so /share/shopping-list/[token] is unaffected by it — confirmed by
// reading that file's matcher/isProtectedPage check.
export default async function SharedShoppingListPage(
  props: PageProps<"/share/shopping-list/[token]">,
) {
  const { token } = await props.params;
  const [list, dict] = await Promise.all([loadList(token), getDictionary()]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      {list ? (
        <Card className="w-full max-w-md">
          <CardContent>
            <UnitsProvider labels={dict.units} plurals={dict.unitsPlural}>
              <SharedShoppingListClient token={token} list={list} dict={dict.sharedShoppingList} />
            </UnitsProvider>
          </CardContent>
        </Card>
      ) : (
        <StatusCard
          brand={dict.auth.brand}
          icon={XCircle}
          tone="error"
          title={dict.sharedShoppingList.notFoundTitle}
        >
          <p className="text-sm text-muted-foreground">
            {dict.sharedShoppingList.notFoundDescription}
          </p>
          <StatusCardLink href="/">{dict.sharedShoppingList.notFoundLink}</StatusCardLink>
        </StatusCard>
      )}
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
