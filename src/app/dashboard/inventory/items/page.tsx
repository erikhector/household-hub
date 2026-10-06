import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { loadCatalog } from "@/lib/inventory/catalog-data";
import { ItemCatalog } from "@/components/inventory/catalog/item-catalog";

// MATCH-7 (design §6.2): every item in the household, with the filters and
// the possible-duplicate groups. Reached from "Manage items" on the
// inventory page; `?filter=duplicates` opens on the groups.
export default async function ItemCatalogPage() {
  const [{ household }, fullDict, locale] = await Promise.all([requireHousehold(), getDictionary(), getLocale()]);
  const dict = fullDict.inventory.catalog;
  const { rows, groups } = await loadCatalog(household.id);

  return (
    <div className="flex max-w-4xl min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/inventory"
          className="touch-target inline-flex w-fit items-center gap-1 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {dict.back}
        </Link>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
      </div>
      <ItemCatalog
        rows={rows}
        groups={groups}
        dict={dict}
        locale={locale}
      />
    </div>
  );
}
