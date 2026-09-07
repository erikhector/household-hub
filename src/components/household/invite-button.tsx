"use client";

import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createInviteAction, sendInviteEmailAction } from "@/lib/actions/household";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function InviteButton({ dict }: { dict: Dictionary["household"]["invite"] }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [isSending, startSendTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !link) {
      startTransition(async () => {
        const result = await createInviteAction();
        if (result.url && result.token) {
          setLink(`${window.location.origin}${result.url}`);
          setToken(result.token);
        } else {
          setError(result.error ?? "Could not create invite link");
        }
      });
    }
  }

  function handleSend() {
    if (!token || !email.trim()) return;
    const recipientEmail = email.trim();
    startSendTransition(async () => {
      const result = await sendInviteEmailAction(token, recipientEmail);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(format(dict.sent, { email: recipientEmail }));
        setEmail("");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline">{dict.button}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.dialogTitle}</DialogTitle>
        </DialogHeader>
        {isPending && !link && (
          <p className="text-sm text-muted-foreground">{dict.generating}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {link && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{dict.description}</p>
              <div className="flex gap-2">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigator.clipboard.writeText(link)}
                >
                  {dict.copy}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-sm text-muted-foreground">{dict.emailLabel}</p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder={dict.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                  disabled={isSending}
                />
                <Button
                  type="button"
                  disabled={isSending || !email.trim()}
                  onClick={handleSend}
                >
                  <Mail className="size-4" />
                  {isSending ? dict.sending : dict.send}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
