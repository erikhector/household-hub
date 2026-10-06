import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getShoppingListByShareToken } from "@/app/share/shopping-list/actions";
import { SharedShoppingListClient } from "@/components/shopping/shared-shopping-list-client";
import { LegalFooter } from "@/components/legal-footer";
import { UnitsProvider } from "@/components/units-provider";
import { getDictionary } from "@/lib/i18n/get-dictionary";

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
  const [list, dict] = await Promise.all([getShoppingListByShareToken(token), getDictionary()]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Card className="w-full max-w-md">
        {list ? (
          <CardContent>
            <UnitsProvider labels={dict.units}>
              <SharedShoppingListClient token={token} list={list} dict={dict.sharedShoppingList} />
            </UnitsProvider>
          </CardContent>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-xl break-words">
                {dict.sharedShoppingList.notFoundTitle}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {dict.sharedShoppingList.notFoundDescription}
              </p>
            </CardContent>
          </>
        )}
      </Card>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
