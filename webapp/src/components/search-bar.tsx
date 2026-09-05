"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { api, fetchAllEvents } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useCalendar } from "@/calendar/contexts/calendar-context";

import type { IEvent } from "@/calendar/interfaces";

const MAX_RESULTS = 60;

/**
 * Hidden behind a typed command so deleting cannot be switched on by idly
 * tapping around on a phone. The passphrase is never typed here — this only
 * opens a masked prompt, so it is not left sitting in a visible box.
 */
const ENTER_COMMANDS = ["enter superuser", "enable superuser"];
const DISABLE_COMMAND = "disable superuser";

type TCommand = { kind: "prompt" } | { kind: "disable" } | null;

function matchCommand(text: string): TCommand {
  const lower = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (lower === DISABLE_COMMAND) return { kind: "disable" };
  if (ENTER_COMMANDS.includes(lower)) return { kind: "prompt" };
  return null;
}

export function SearchBar() {
  const { setSelectedDate, superuser, setSuperuser, setEventToOpen, setAskForSuperuser } = useCalendar();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<IEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The whole database is pulled once, the first time the box is used, so
  // results span every year rather than just the months currently on screen.
  const loadAll = async () => {
    if (all || loading) return;
    setLoading(true);
    setError("");
    try {
      setAll(await fetchAllEvents());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load events.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !all) return [];
    return all
      .filter(e => e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, MAX_RESULTS);
  }, [all, query]);

  /** Handles the superuser commands; returns true if the text was one. */
  const runCommand = () => {
    const command = matchCommand(query);
    if (!command) return false;

    setQuery("");
    setOpen(false);
    inputRef.current?.blur();

    if (command.kind === "prompt") {
      setAskForSuperuser(true);
      return true;
    }

    void (async () => {
      await api("/api/superuser", { method: "DELETE" }).catch(() => {});
      setSuperuser(false);
      toast("Superuser disabled — renaming and deleting are switched off.", "info");
    })();

    return true;
  };

  /**
   * Enter and Go: run a command, or move the calendar to the first match.
   * Deliberately does not open the event — auto-opening whichever one sorted
   * first after a few letters was more startling than useful.
   */
  const submit = () => {
    if (runCommand()) return;
    if (!results.length) return;

    setSelectedDate(parseISO(results[0].startDate));
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const choose = (event: IEvent) => {
    // Move the calendar to it *and* open it — landing on the right month with
    // nothing selected left you hunting for the event you just picked.
    setSelectedDate(parseISO(event.startDate));
    setEventToOpen(event);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const isCommand = matchCommand(query) !== null;
  const showPanel = open && !isCommand && (query.trim().length > 0 || loading || !!error);

  return (
    <div ref={containerRef} className="flex w-full items-center gap-1.5 lg:w-80">
      <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

      <Input
        ref={inputRef}
        // Deliberately not type="search": WebKit and Blink add their own clear
        // button, which would sit next to the one below it.
        type="text"
        aria-label="Search all events"
        placeholder={superuser ? "Search Events as Superuser" : "Search all events…"}
        className="h-9 pl-8 pr-8"
        value={query}
        onFocus={() => {
          setOpen(true);
          void loadAll();
        }}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
          void loadAll();
        }}
        onKeyDown={e => {
          if (e.key === "Escape") {
            setQuery("");
            setOpen(false);
            inputRef.current?.blur();
          }
          if (e.key !== "Enter") return;
          e.preventDefault();
          submit();
        }}
      />

      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {loading && (
            <p className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading events…
            </p>
          )}

          {error && <p className="px-2 py-3 text-sm font-medium text-destructive">{error}</p>}

          {!loading && !error && query.trim() && results.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p>}

          {results.map(event => (
            <button
              key={event.id}
              type="button"
              onClick={() => choose(event)}
              className="flex w-full flex-col items-start gap-0.5 rounded-sm p-2 text-left hover:bg-accent hover:text-accent-foreground"
            >
              <span className="w-full truncate text-sm font-medium">{event.title}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {format(parseISO(event.startDate), "EEE, d MMM yyyy")}
                {!event.allDay && ` · ${format(parseISO(event.startDate), "h:mm a")}`}
                {event.repeatYearly && " · yearly"}
              </span>
            </button>
          ))}

          {results.length === MAX_RESULTS && <p className="px-2 py-1.5 text-xs text-muted-foreground">Showing the first {MAX_RESULTS} matches.</p>}
        </div>
      )}
      </div>

      <Button type="button" variant="outline" className="h-9 shrink-0 px-2 text-xs" aria-label="Go to the first match" onClick={submit} disabled={!query.trim()}>
        Go
      </Button>
    </div>
  );
}
