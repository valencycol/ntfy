"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { api } from "@/lib/api";

interface INtfyInfo {
  server: string;
  topic: string;
  topicHasStrayWhitespace: boolean;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; the value is selectable on screen either way */
    }
  };

  return (
    <div className="grid min-w-0 gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">{value}</code>
        <Button type="button" size="icon" variant="outline" aria-label={`Copy ${label}`} onClick={copy} className="shrink-0">
          {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

export function SetupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [info, setInfo] = useState<INtfyInfo | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [ntfy, feed] = await Promise.all([api<INtfyInfo>("/api/ntfy-info"), api<{ url: string }>("/api/feed-url")]);
        setInfo(ntfy);
        setFeedUrl(feed.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load setup details.");
      }
    })();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>iPhone setup</DialogTitle>
          <DialogDescription>Subscribe to reminders in the ntfy app, and to the calendar itself in iOS Calendar.</DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}

        {info && (
          <div className="space-y-5">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">1. Reminders via ntfy</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Install the ntfy app from the App Store.</li>
                <li>
                  Open <span className="font-medium text-foreground">Settings → Default server</span> and set it to the server below.
                </li>
                <li>
                  Tap <span className="font-medium text-foreground">+</span> and subscribe to the topic below.
                </li>
              </ol>

              <CopyRow label="Server" value={info.server} />
              <CopyRow label="Topic" value={info.topic} />

              <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  The topic is the only thing protecting these reminders — anyone who has it can read them or send fake ones. Don&apos;t paste it anywhere
                  public, and rotate it if it leaks.
                </span>
              </p>

              {info.topicHasStrayWhitespace && (
                <p className="text-xs font-medium text-destructive">
                  The stored topic has stray whitespace around it, which will break delivery. Re-set the NTFY_TOPIC secret using printf rather than echo.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">2. The calendar in iOS Calendar</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Settings → Apps → Calendar → Accounts → Add Account → Other</span>
                </li>
                <li>
                  Choose <span className="font-medium text-foreground">Add Subscribed Calendar</span> and paste this URL.
                </li>
              </ol>

              <CopyRow label="Subscription URL" value={feedUrl} />
              <p className="text-xs text-muted-foreground">Read-only. Anyone with this link can see your events, so treat it as a secret too.</p>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
