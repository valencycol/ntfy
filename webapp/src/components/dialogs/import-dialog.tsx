"use client";

import { useState } from "react";
import { Download, Link2, Upload } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { api } from "@/lib/api";
import { useCalendar } from "@/calendar/contexts/calendar-context";
import { icsToEvent, looksLikeZip, nextOccurrencePreview, parseICS } from "@/lib/ics";

import type { IImportEvent } from "@/lib/ics";

interface IStaged extends IImportEvent {
  key: number;
  selected: boolean;
  /** Shown when a TZID names a timezone other than this browser's. */
  foreignTz: boolean;
}

function describe(event: IImportEvent) {
  if (event.all_day) {
    const span = event.end_date > event.start_date ? `${event.start_date} → ${event.end_date}` : event.start_date;
    return `${span} · All day`;
  }
  return `${event.start_date} · ${event.start_time}–${event.end_time}`;
}

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { refreshEvents } = useCalendar();

  const [url, setUrl] = useState("");
  const [staged, setStaged] = useState<IStaged[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const stage = (text: string) => {
    setError("");
    setStatus("");

    if (looksLikeZip(text)) {
      setStaged([]);
      setError("That looks like a .zip archive. Unzip it first and pick the .ics file inside.");
      return;
    }

    const parsed = parseICS(text);
    const rows = parsed
      .map(icsToEvent)
      .filter((e): e is IImportEvent => e !== null)
      .map((event, i) => ({
        ...event,
        key: i,
        selected: true,
        foreignTz: !!parsed[i]?.start?.foreignTz,
      }));

    setStaged(rows);
    if (rows.length === 0) setError("No events found in that file.");
    else setStatus(`Found ${rows.length} event${rows.length === 1 ? "" : "s"}.`);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    stage(await file.text());
  };

  const onFetchLink = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { text } = await api<{ text: string }>("/api/import/fetch", { method: "POST", body: JSON.stringify({ url: url.trim() }) });
      stage(text);
    } catch (err) {
      setStaged([]);
      setError(err instanceof Error ? err.message : "Could not load that link.");
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    const chosen = staged.filter(s => s.selected);
    if (!chosen.length) {
      setError("Select at least one event to import.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const payload = chosen.map(({ key: _key, selected: _selected, foreignTz: _foreignTz, ...event }) => event);
      const { imported, rejected } = await api<{ imported: number; rejected: number }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ events: payload }),
      });

      const skipped = chosen.length - imported - rejected;
      setStatus(
        [
          `Imported ${imported}.`,
          rejected ? `${rejected} rejected as invalid.` : "",
          skipped > 0 ? `${skipped} already in the calendar.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
      setStaged([]);
      await refreshEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const patch = (key: number, changes: Partial<IStaged>) => setStaged(prev => prev.map(s => (s.key === key ? { ...s, ...changes } : s)));

  const selectedCount = staged.filter(s => s.selected).length;

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        onOpenChange(next);
        if (!next) {
          setStaged([]);
          setError("");
          setStatus("");
          setUrl("");
        }
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import events</DialogTitle>
          <DialogDescription>From an .ics file or a calendar link. You can rename anything before importing.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="i-file" className="flex items-center gap-1.5">
              <Upload className="size-3.5" />
              From a file
            </Label>
            <Input id="i-file" type="file" accept=".ics,text/calendar" onChange={e => onFile(e.target.files?.[0])} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="i-url" className="flex items-center gap-1.5">
              <Link2 className="size-3.5" />
              Or from a link
            </Label>
            <div className="flex gap-2">
              <Input
                id="i-url"
                inputMode="url"
                placeholder="https://…/basic.ics"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  void onFetchLink();
                }}
              />
              <Button type="button" variant="outline" onClick={onFetchLink} disabled={busy || !url.trim()}>
                Load
              </Button>
            </div>
          </div>
        </div>

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        {status && <p className="text-sm text-muted-foreground">{status}</p>}

        {staged.length > 0 && (
          <>
            <div className="flex items-center justify-between border-b pb-2 text-sm">
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={selectedCount === staged.length}
                  onChange={e => setStaged(prev => prev.map(s => ({ ...s, selected: e.target.checked })))}
                />
                Select all
              </label>
              <span className="text-muted-foreground">
                {selectedCount} of {staged.length} selected
              </span>
            </div>

            <div className="-mx-1 flex-1 overflow-y-auto px-1">
              <ul className="divide-y">
                {staged.map(row => (
                  <li key={row.key} className="flex items-start gap-2 py-2">
                    <input
                      type="checkbox"
                      className="mt-2"
                      checked={row.selected}
                      aria-label={`Import ${row.title}`}
                      onChange={e => patch(row.key, { selected: e.target.checked })}
                    />

                    <div className="min-w-0 flex-1">
                      <Input value={row.title} aria-label="Event title" className="h-8" onChange={e => patch(row.key, { title: e.target.value })} />

                      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                        {describe(row)}
                        {row.repeat_yearly && <span className="ml-1 font-medium text-foreground">· yearly, next {nextOccurrencePreview(row.start_date)}</span>}
                        {row.foreignTz && <span className="ml-1 font-medium text-destructive">· different timezone</span>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <Button type="button" onClick={doImport} disabled={busy || !selectedCount}>
              <Download className="size-4" />
              {busy ? "Importing…" : `Import ${selectedCount} event${selectedCount === 1 ? "" : "s"}`}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
