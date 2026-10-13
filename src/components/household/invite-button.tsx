"use client";

import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
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
          setError(result.error ?? dict.createFailed);
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
      <DialogTrigger render={<Button>{dict.button}</Button>} />
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
              <div className="flex flex-wrap gap-2">
                <Input
                  readOnly
                  className="min-w-[12rem] flex-1"
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={dict.linkAriaLabel}
                />
                <CopyLinkButton url={link} dict={dict} shareTitle={dict.dialogTitle} />
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-sm text-muted-foreground">{dict.emailLabel}</p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
              >
                <Input
                  type="email"
                  autoComplete="off"
                  enterKeyHint="send"
                  placeholder={dict.emailPlaceholder}
                  aria-label={dict.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                  disabled={isSending}
                />
                <Button type="submit" disabled={isSending || !email.trim()}>
                  <Mail className="size-4" />
                  {isSending ? dict.sending : dict.send}
                </Button>
              </form>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
