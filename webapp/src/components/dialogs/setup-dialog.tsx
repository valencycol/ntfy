"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Link2, Send } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { api } from "@/lib/api";

interface INtfyInfo {
  server: string;
  topic: string;
  topicHasStrayWhitespace: boolean;
}

type TChannel = "ntfy" | "telegram" | "both";

interface INotifySettings {
  channel: TChannel;
  telegram: {
    tokenSet: boolean;
    chatId: string;
    bot: string | null;
    error: string | null;
  };
}

interface IDiscoveredChat {
  id: string;
  name: string;
  type: string;
}

const CHANNEL_LABELS: Record<TChannel, string> = {
  ntfy: "ntfy only",
  telegram: "Telegram only",
  both: "Both",
};

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

  const [settings, setSettings] = useState<INotifySettings | null>(null);
  const [channel, setChannel] = useState<TChannel>("ntfy");
  const [chatId, setChatId] = useState("");
  const [chats, setChats] = useState<IDiscoveredChat[] | null>(null);
  const [telegramState, setTelegramState] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    const next = await api<INotifySettings>("/api/notify-settings");
    setSettings(next);
    setChannel(next.channel);
    setChatId(next.telegram.chatId);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTelegramState("");
    setChats(null);
    (async () => {
      try {
        const [ntfy, feed] = await Promise.all([
          api<INtfyInfo>("/api/ntfy-info"),
          api<{ url: string }>("/api/feed-url"),
          loadSettings(),
        ]);
        setInfo(ntfy);
        setFeedUrl(feed.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load setup details.");
      }
    })();
  }, [open, loadSettings]);

  // Telegram bots cannot open a conversation, so the chat ID only exists once
  // the user has sent the bot something. This asks the bot who has.
  const discover = async () => {
    setBusy(true);
    setTelegramState("Looking for chats…");
    try {
      const { chats: found } = await api<{ chats: IDiscoveredChat[] }>("/api/telegram/discover", { method: "POST" });
      setChats(found);
      if (found.length === 1) setChatId(found[0].id);
      setTelegramState(found.length ? "" : "No chats yet — send the bot a message, then look again.");
    } catch (err) {
      setTelegramState(err instanceof Error ? err.message : "Could not reach Telegram.");
    } finally {
      setBusy(false);
    }
  };

  const saveChannel = async () => {
    setBusy(true);
    setTelegramState("Saving…");
    try {
      await api("/api/notify-settings", {
        method: "PUT",
        body: JSON.stringify({ channel, telegram_chat_id: chatId.trim() }),
      });
      await loadSettings();
      setTelegramState("Saved.");
    } catch (err) {
      setTelegramState(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setTelegramState("Sending…");
    try {
      await api("/api/telegram/test", { method: "POST", body: JSON.stringify({ telegram_chat_id: chatId.trim() }) });
      setTelegramState("Sent — check Telegram.");
    } catch (err) {
      setTelegramState(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>iPhone setup</DialogTitle>
          <DialogDescription>Choose where reminders are sent, and subscribe to the calendar itself in iOS Calendar.</DialogDescription>
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
              <h3 className="text-sm font-semibold">2. Reminders via Telegram</h3>

              {settings && !settings.telegram.tokenSet ? (
                <p className="text-sm text-muted-foreground">
                  Create a bot with <span className="font-medium text-foreground">@BotFather</span>, then set its token as the{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">TELEGRAM_BOT_TOKEN</code> secret and redeploy. This section unlocks once
                  it&apos;s there.
                </p>
              ) : (
                <>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>
                      Open a chat with{" "}
                      <span className="font-medium text-foreground">{settings?.telegram.bot ? `@${settings.telegram.bot}` : "your bot"}</span> and tap{" "}
                      <span className="font-medium text-foreground">Start</span> — a bot can&apos;t message you until you message it.
                    </li>
                    <li>
                      Tap <span className="font-medium text-foreground">Find my chat</span> below, then <span className="font-medium text-foreground">Send test</span>.
                    </li>
                  </ol>

                  {settings?.telegram.error && <p className="text-xs font-medium text-destructive">{settings.telegram.error}</p>}

                  <div className="grid gap-1">
                    <label htmlFor="telegram-chat-id" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Chat ID
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="telegram-chat-id"
                        placeholder="e.g. 123456789"
                        value={chatId}
                        onChange={e => setChatId(e.target.value)}
                        className="font-mono"
                      />
                      <Button type="button" variant="outline" onClick={discover} disabled={busy} className="shrink-0">
                        <Link2 className="size-4" />
                        Find my chat
                      </Button>
                    </div>
                  </div>

                  {chats && chats.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {chats.map(chat => (
                        <li key={chat.id}>
                          <Button type="button" size="sm" variant={chatId === chat.id ? "default" : "outline"} onClick={() => setChatId(chat.id)}>
                            {chat.name}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="grid gap-1">
                    <label htmlFor="notify-channel" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Send reminders to
                    </label>
                    <Select value={channel} onValueChange={value => setChannel(value as TChannel)}>
                      <SelectTrigger id="notify-channel">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CHANNEL_LABELS) as TChannel[]).map(key => (
                          <SelectItem key={key} value={key}>
                            {CHANNEL_LABELS[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" onClick={saveChannel} disabled={busy}>
                      Save
                    </Button>
                    <Button type="button" variant="outline" onClick={sendTest} disabled={busy || !chatId.trim()}>
                      <Send className="size-4" />
                      Send test
                    </Button>
                    {telegramState && <p className="text-sm text-muted-foreground">{telegramState}</p>}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    On <span className="font-medium">Both</span>, a reminder counts as delivered as soon as either channel accepts it, so one being down
                    never re-sends on the other.
                  </p>
                </>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">3. The calendar in iOS Calendar</h3>
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
