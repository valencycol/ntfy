"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getISOWeek, getISOWeeksInYear, getISOWeekYear, setISOWeek, startOfISOWeek } from "date-fns";
import { Bell, ChevronDown, Download, Lock, Settings, Smartphone, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useToast } from "@/components/toast";
import { SearchBar } from "@/components/search-bar";
import { ToggleTheme } from "@/components/toggle-theme";
import { SetupDialog } from "@/components/dialogs/setup-dialog";
import { ImportDialog } from "@/components/dialogs/import-dialog";
import { SettingsDialog } from "@/components/dialogs/settings-dialog";
import { SuperuserDialog } from "@/components/dialogs/superuser-dialog";
import { DayEventsDialog } from "@/components/dialogs/day-events-dialog";
import { EventDialog } from "@/calendar/components/dialogs/event-dialog";
import { NotificationsDialog } from "@/components/dialogs/notifications-dialog";

import { api } from "@/lib/api";
import { useCalendar } from "@/calendar/contexts/calendar-context";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type TDialog = "import" | "setup" | "notifications" | "settings" | null;

export function AppBar() {
  const router = useRouter();
  const { selectedDate, setSelectedDate, highlightedWeek, setHighlightedWeek, eventToOpen, setEventToOpen, newEventDate, setNewEventDate } =
    useCalendar();
  const toast = useToast();

  const [dialog, setDialog] = useState<TDialog>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [weekDraft, setWeekDraft] = useState("");
  const [yearDraft, setYearDraft] = useState("");

  const openDialog = (which: TDialog) => {
    setMenuOpen(false);
    setDialog(which);
  };

  const lock = async () => {
    setMenuOpen(false);
    await api("/api/logout", { method: "POST" }).catch(() => {});
    // A reload is the simplest way to drop every bit of in-memory event data
    // along with the session, rather than trusting each component to clear.
    router.refresh();
    window.location.href = "/";
  };

  const jumpMonth = (monthIndex: string) => {
    const next = new Date(selectedDate);
    next.setDate(1);
    next.setMonth(Number(monthIndex));
    setSelectedDate(next);
  };

  const commitWeek = () => {
    if (!weekDraft) return;

    const week = Number(weekDraft);
    if (!Number.isInteger(week) || week < 1 || week > 53) {
      toast(`Week ${weekDraft} is not a week — enter 1 to 53.`, "error");
      setWeekDraft("");
      return;
    }

    // Most years have 52 ISO weeks; only some have a 53rd. Asking for one that
    // does not exist used to roll silently into week 1 of the next year and
    // highlight nothing at all.
    const weeksAvailable = getISOWeeksInYear(selectedDate);
    if (week > weeksAvailable) {
      toast(`${getISOWeekYear(selectedDate)} has only ${weeksAvailable} weeks — there is no week ${week}.`, "error");
      setWeekDraft("");
      return;
    }

    const monday = startOfISOWeek(setISOWeek(selectedDate, week));
    setSelectedDate(monday);
    // Outline the week that was landed on, so the jump is visible.
    setHighlightedWeek({ year: getISOWeekYear(monday), week });
    setWeekDraft("");
  };

  const commitYear = () => {
    if (!yearDraft) return;

    // Anything shorter than four digits is still being typed, not an error.
    if (yearDraft.length < 4) {
      toast(`"${yearDraft}" is not a year — enter all four digits.`, "error");
      setYearDraft("");
      return;
    }

    const year = Number(yearDraft);
    if (year < 1970 || year > 2200) {
      toast(`${year} is outside the range this calendar covers (1970–2200).`, "error");
      setYearDraft("");
      return;
    }

    const next = new Date(selectedDate);
    next.setFullYear(year);
    setSelectedDate(next);
    setYearDraft("");
  };

  return (
    <>
      <div className="flex flex-col gap-3 pb-3 lg:flex-row lg:items-end lg:justify-between">
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            {/* self-start keeps it from stretching when the bar wraps on
                narrow screens; from lg up it defers to the row's items-end so
                it sits on the same baseline as the search box and jump fields. */}
            <Button variant="ghost" className="-ml-2 h-9 shrink-0 gap-1.5 self-start px-2 text-lg font-semibold lg:self-auto">
              Colaco Calendar
              <ChevronDown className="size-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-56 p-1">
            <MenuItem icon={<Download className="size-4" />} label="Import" onClick={() => openDialog("import")} />
            <MenuItem icon={<Smartphone className="size-4" />} label="iPhone setup" onClick={() => openDialog("setup")} />
            <MenuItem icon={<Bell className="size-4" />} label="Notifications" onClick={() => openDialog("notifications")} />
            <MenuItem icon={<Settings className="size-4" />} label="Calendar settings" onClick={() => openDialog("settings")} />
            <div className="my-1 h-px bg-border" />
            <MenuItem icon={<Lock className="size-4" />} label="Lock" onClick={lock} />
          </PopoverContent>
        </Popover>

        {/* Stacks on a phone — title, then the search box, then one row of
            Today + the jump fields — and collapses onto a single row from lg. */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
          <SearchBar />

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <Button type="button" variant="outline" className="h-9 px-2.5 sm:px-3" onClick={() => setSelectedDate(new Date())}>
              Today
            </Button>

            {/* The month dropdown names itself, and the two number boxes say
                what they are in their placeholder, so the bar reads as one line. */}
            <div className="flex items-center gap-1.5">
              <Select value={String(selectedDate.getMonth())} onValueChange={jumpMonth}>
                <SelectTrigger id="jump-month" aria-label="Month" className="h-9 w-32 sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((month, i) => (
                    <SelectItem key={month} value={String(i)}>
                      {month}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Input
                id="jump-week"
                inputMode="numeric"
                aria-label="Week"
                className="h-9 w-[6.5rem] px-2 tabular-nums sm:px-3"
                placeholder={`Week (${getISOWeek(selectedDate)})`}
                value={weekDraft}
                onChange={e => {
                  setWeekDraft(e.target.value.replace(/\D/g, "").slice(0, 2));
                  // Typing a different week means the outlined one is stale.
                  if (highlightedWeek) setHighlightedWeek(null);
                }}
                onKeyDown={e => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  commitWeek();
                }}
              />

              {/* Once a week is outlined, the same button undoes it. */}
              {highlightedWeek ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  aria-label={`Clear the week ${highlightedWeek.week} highlight`}
                  onClick={() => {
                    setHighlightedWeek(null);
                    setWeekDraft("");
                    toast(`Week ${highlightedWeek.week} highlight cleared.`, "info");
                  }}
                >
                  <X className="size-4" />
                </Button>
              ) : (
                <Button type="button" variant="outline" className="h-9 shrink-0 px-2 text-xs" aria-label="Go to this week" onClick={commitWeek}>
                  Go
                </Button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <Input
                id="jump-year"
                inputMode="numeric"
                aria-label="Year"
                className="h-9 w-[7rem] px-2 tabular-nums sm:px-3"
                placeholder={`Year (${selectedDate.getFullYear()})`}
                value={yearDraft}
                // Strip non-digits before truncating, so pasting "abc2027xy" gives 2027.
                onChange={e => setYearDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={e => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  commitYear();
                }}
              />

              <Button type="button" variant="outline" className="h-9 shrink-0 px-2 text-xs" aria-label="Go to this year" onClick={commitYear}>
                Go
              </Button>
            </div>

            <ToggleTheme />
          </div>
        </div>
      </div>

      <ImportDialog open={dialog === "import"} onOpenChange={open => setDialog(open ? "import" : null)} />
      <SetupDialog open={dialog === "setup"} onOpenChange={open => setDialog(open ? "setup" : null)} />
      <NotificationsDialog open={dialog === "notifications"} onOpenChange={open => setDialog(open ? "notifications" : null)} />
      <SettingsDialog open={dialog === "settings"} onOpenChange={open => setDialog(open ? "settings" : null)} />

      {/* Opened from a search result or a day's event list, from anywhere. */}
      <DayEventsDialog />
      <SuperuserDialog />
      {eventToOpen && <EventDialog event={eventToOpen} open onOpenChange={open => !open && setEventToOpen(null)} />}
      {newEventDate && <EventDialog startDate={newEventDate} open onOpenChange={open => !open && setNewEventDate(null)} />}
    </>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-sm p-2 text-sm hover:bg-accent hover:text-accent-foreground">
      {icon}
      {label}
    </button>
  );
}
