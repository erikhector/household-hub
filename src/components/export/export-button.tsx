import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A plain link to a Route Handler that streams a file download (CSV, JSON,
 * ...), styled as a button. No client-side JS needed — the browser's own
 * navigation to a `Content-Disposition: attachment` response handles the
 * download, so this works even with JS disabled and needs no loading state. */
export function ExportButton({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="outline" render={<Link href={href} prefetch={false} />}>
      <Download className="size-4" />
      {label}
    </Button>
  );
}
