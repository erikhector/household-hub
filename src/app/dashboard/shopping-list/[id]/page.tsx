import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { ShoppingListClient } from "@/components/shopping/shopping-list-client";

export default async function ShoppingListDetailPage(
  props: PageProps<"/dashboard/shopping-list/[id]">,
) {
  const [{ household }, dict, { id }] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    props.params,
  ]);

  const list = await prisma.shoppingList.findFirst({
    where: { id, householdId: household.id },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!list) notFound();

  return <ShoppingListClient list={list} dict={dict.shoppingList} />;
}
