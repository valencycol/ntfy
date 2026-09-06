"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, BellOff, Check, Copy, Link2, RefreshCw, Send, Trash2, UserPlus } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface INtfyInfo {
  server: string;
  topic: string;
  topicHasStrayWhitespace: boolean;
}

type TChannel = "ntfy" | "telegram" | "both";

interface IRecipient {
  id: string;
  name: string;
  handle: string | null;
  handle_kind: string | null;
  chat_id: string | null;
  tg_username: string | null;
  linked_at: number | null;
  enabled: number;
  /** Deep link to send them; null once they are linked. */
  invite: string | null;
}

interface IDetectedChat {
  chat_id: string;
  name: string;
  username: string | null;
}

interface INotifySettings {
  channel: TChannel;
  telegram: {
    tokenSet: boolean;
    bot: string | null;
    error: string | null;
    recipients: IRecipient[];
    detected: IDetectedChat[];
  };
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
  const [newName, setNewName] = useState("");
  const [newHandle, setNewHandle] = useState("");
  const [telegramState, setTelegramState] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    const next = await api<INotifySettings>("/api/notify-settings");
    setSettings(next);
    setChannel(next.channel);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTelegramState("");
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

  const run = async (label: string, work: () => Promise<string>) => {
    setBusy(true);
    setTelegramState(label);
    try {
      setTelegramState(await work());
      await loadSettings();
    } catch (err) {
      setTelegramState(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const addRecipient = () =>
    run("Adding…", async () => {
      await api("/api/telegram/recipients", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), handle: newHandle.trim() }),
      });
      setNewName("");
      setNewHandle("");
      return "Added. Send them their invite link.";
    });

  const removeRecipient = (id: string, name: string) => run("Removing…", async () => {
    await api(`/api/telegram/recipients/${id}`, { method: "DELETE" });
    return `Removed ${name}.`;
  });

  const toggleRecipient = (person: IRecipient) =>
    run(person.enabled ? "Muting…" : "Unmuting…", async () => {
      await api(`/api/telegram/recipients/${person.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !person.enabled }) });
      return person.enabled ? `${person.name} muted.` : `${person.name} unmuted.`;
    });

  // The cron polls for this every minute anyway; the button is for "I just
  // tapped the link, don't make me wait".
  const checkLinks = () =>
    run("Checking…", async () => {
      const { bound } = await api<{ bound: number }>("/api/telegram/poll", { method: "POST" });
      return bound ? `Linked ${bound} ${bound === 1 ? "person" : "people"}.` : "Nobody new yet.";
    });

  const saveChannel = () =>
    run("Saving…", async () => {
      await api("/api/notify-settings", { method: "PUT", body: JSON.stringify({ channel }) });
      return "Saved.";
    });

  const sendTest = (id?: string) =>
    run("Sending…", async () => {
      await api("/api/telegram/test", { method: "POST", body: JSON.stringify(id ? { id } : {}) });
      return "Sent — check Telegram.";
    });

  const copyInvite = async (invite: string) => {
    try {
      await navigator.clipboard.writeText(invite);
      setTelegramState("Invite link copied.");
    } catch {
      setTelegramState(invite);
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
                  <p className="text-sm text-muted-foreground">
                    Reminders go to everyone below. Add a person by their{" "}
                    <span className="font-medium text-foreground">@username</span> or{" "}
                    <span className="font-medium text-foreground">phone number</span>, then send them the invite link — a bot can&apos;t
                    message anyone until they&apos;ve started it.
                  </p>

                  {settings?.telegram.error && <p className="text-xs font-medium text-destructive">{settings.telegram.error}</p>}

                  <ul className="divide-y rounded-md border">
                    {settings?.telegram.recipients.length === 0 && (
                      <li className="px-3 py-4 text-center text-sm text-muted-foreground">Nobody yet.</li>
                    )}

                    {settings?.telegram.recipients.map(person => (
                      <li key={person.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-sm font-medium", !person.enabled && "text-muted-foreground line-through")}>{person.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {person.chat_id ? (
                              <span className="text-green-600 dark:text-green-500">Linked{person.tg_username ? ` · @${person.tg_username}` : ""}</span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-500">Waiting for them to tap Start</span>
                            )}
                            {person.handle && <span> · {person.handle}</span>}
                          </p>
                        </div>

                        {person.invite && (
                          <Button type="button" size="sm" variant="outline" onClick={() => copyInvite(person.invite!)}>
                            <Link2 className="size-3.5" />
                            Copy invite
                          </Button>
                        )}

                        {person.chat_id && (
                          <>
                            <Button type="button" size="sm" variant="outline" onClick={() => sendTest(person.id)} disabled={busy}>
                              <Send className="size-3.5" />
                              Test
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => toggleRecipient(person)}
                              disabled={busy}
                              aria-label={person.enabled ? `Mute ${person.name}` : `Unmute ${person.name}`}
                            >
                              {person.enabled ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
                            </Button>
                          </>
                        )}

                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeRecipient(person.id, person.name)}
                          disabled={busy}
                          aria-label={`Remove ${person.name}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="grid min-w-0 flex-1 gap-1">
                      <label htmlFor="tg-name" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Name
                      </label>
                      <Input id="tg-name" placeholder="Alvita" value={newName} onChange={e => setNewName(e.target.value)} />
                    </div>
                    <div className="grid min-w-0 flex-1 gap-1">
                      <label htmlFor="tg-handle" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        @username or phone
                      </label>
                      <Input id="tg-handle" placeholder="@alvita" value={newHandle} onChange={e => setNewHandle(e.target.value)} />
                    </div>
                    <Button type="button" onClick={addRecipient} disabled={busy || !newName.trim() || !newHandle.trim()}>
                      <UserPlus className="size-4" />
                      Add
                    </Button>
                  </div>

                  {settings && settings.telegram.detected.length > 0 && (
                    <div className="grid gap-1.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Started the bot, not on the list</p>
                      <ul className="flex flex-wrap gap-2">
                        {settings.telegram.detected.map(chat => (
                          <li key={chat.chat_id}>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                setNewName(chat.name);
                                setNewHandle(chat.chat_id);
                              }}
                            >
                              {chat.name}
                            </Button>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground">Tap one to fill the form in, then Add.</p>
                    </div>
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
                    <Button type="button" variant="outline" onClick={checkLinks} disabled={busy}>
                      <RefreshCw className="size-4" />
                      Check for new links
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
