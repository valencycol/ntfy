"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, RefreshCw, Send, Zap } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { api } from "@/lib/api";

interface IUpcoming {
  id: string;
  notify_at: number;
  attempts: number;
  title: string;
  all_day: number;
  start_time: string | null;
}

function whenLabel(epochSeconds: number) {
  const at = new Date(epochSeconds * 1000);
  const mins = Math.round((at.getTime() - Date.now()) / 60000);
  const relative = mins < 0 ? `${-mins}m overdue` : mins < 60 ? `in ${mins}m` : `in ${Math.round(mins / 60)}h`;
  return `${at.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${relative}`;
}

export function NotificationsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [rows, setRows] = useState<IUpcoming[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sendState, setSendState] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const { upcoming } = await api<{ upcoming: IUpcoming[] }>("/api/upcoming");
      setRows(upcoming);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reminders.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const fire = async (id: string) => {
    setBusyId(id);
    try {
      await api(`/api/reminders/${id}/fire`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that reminder.");
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (id: string) => {
    setBusyId(id);
    try {
      await api(`/api/reminders/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel that reminder.");
    } finally {
      setBusyId(null);
    }
  };

  const send = async () => {
    if (!message.trim()) return;
    setSendState("Sending…");
    try {
      await api("/api/notify", { method: "POST", body: JSON.stringify({ message: message.trim() }) });
      setMessage("");
      setSendState("Sent.");
      setTimeout(() => setSendState(""), 2500);
    } catch (err) {
      setSendState(err instanceof Error ? err.message : "Could not send.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Notifications</DialogTitle>
          <DialogDescription>Reminders due for a push in the next 48 hours. Send one now, or cancel it.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Send a message to ntfy…"
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              void send();
            }}
          />
          <Button type="button" onClick={send} disabled={!message.trim()}>
            <Send className="size-4" />
            Send
          </Button>
        </div>
        {sendState && <p className="text-sm text-muted-foreground">{sendState}</p>}

        <div className="flex items-center justify-between border-b pb-2">
          <p className="text-sm font-semibold">Due soon</p>
          <Button type="button" size="sm" variant="ghost" onClick={load}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}

        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {rows === null && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
          {rows?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing due in the next 48 hours.</p>}

          <ul className="divide-y">
            {rows?.map(row => (
              <li key={row.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.title}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {whenLabel(row.notify_at)}
                    {row.attempts > 0 && <span className="ml-1 text-destructive">· {row.attempts} failed attempt(s)</span>}
                  </p>
                </div>

                <Button type="button" size="sm" variant="outline" onClick={() => fire(row.id)} disabled={busyId === row.id}>
                  <Zap className="size-3.5" />
                  Send now
                </Button>

                <Button type="button" size="sm" variant="ghost" onClick={() => cancel(row.id)} disabled={busyId === row.id}>
                  <Ban className="size-3.5" />
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
