import { getDictionary } from "@/lib/i18n/get-dictionary";

export default async function DashboardLoading() {
  const dict = await getDictionary();
  return (
    <div className="animate-pulse space-y-6" role="status" aria-label={dict.common.loading}>
      <div className="h-7 w-48 rounded-md bg-muted" />
      <div className="list-bleed grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 rounded-lg border bg-muted/40" />
        ))}
      </div>
    </div>
  );
}
