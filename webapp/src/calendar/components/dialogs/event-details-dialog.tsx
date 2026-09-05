"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Bell, Calendar, RefreshCw, Text } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EventDialog } from "@/calendar/components/dialogs/event-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

import type { IEvent } from "@/calendar/interfaces";

interface IProps {
  event: IEvent;
  children: React.ReactNode;
}

/** How much of a note is shown before it is cut off. */
const NOTE_PREVIEW_CHARS = 300;

function prettyTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function EventDetailsDialog({ event, children }: IProps) {
  // Editing replaces the details dialog rather than stacking on top of it —
  // otherwise the stale details view stays open behind the editor.
  const [showDetails, setShowDetails] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showFullNote, setShowFullNote] = useState(false);

  const startDate = parseISO(event.startDate);
  const endDate = parseISO(event.endDate);

  // A long note would otherwise be clipped by the dialog, so only a preview is
  // shown inline and the rest is one tap away.
  const isLongNote = event.description.length > NOTE_PREVIEW_CHARS;
  const notePreview = event.description.slice(0, NOTE_PREVIEW_CHARS);

  const when = event.allDay
    ? format(startDate, "MMM d, yyyy") === format(endDate, "MMM d, yyyy")
      ? `${format(startDate, "EEEE, MMM d, yyyy")} · All day`
      : `${format(startDate, "MMM d")} – ${format(endDate, "MMM d, yyyy")} · All day`
    : `${format(startDate, "EEEE, MMM d, yyyy")} · ${format(startDate, "h:mm a")} – ${format(endDate, "h:mm a")}`;

  return (
    <>
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2">
            <Calendar className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm">{when}</p>
          </div>

          {event.repeatYearly && (
            <div className="flex items-start gap-2">
              <RefreshCw className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-sm">Repeats every year</p>
            </div>
          )}

          <div className="flex items-start gap-2">
            <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Reminders</p>
              <p className="text-sm text-muted-foreground">
                {event.reminderTimes.length ? event.reminderTimes.map(prettyTime).join(" · ") : "None — this event will not push."}
              </p>
            </div>
          </div>

          {event.description && (
            <div className="flex items-start gap-2">
              <Text className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Notes</p>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {isLongNote ? notePreview.trimEnd() : event.description}
                  {isLongNote && (
                    <button
                      type="button"
                      onClick={() => setShowFullNote(true)}
                      aria-label="Read the whole note"
                      className="ml-0.5 font-semibold text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      … read all
                    </button>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setShowDetails(false);
              setShowEditor(true);
            }}
          >
            Edit
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>

      <EventDialog event={event} open={showEditor} onOpenChange={setShowEditor} />

      <Dialog open={showFullNote} onOpenChange={setShowFullNote}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notes</DialogTitle>
            <DialogDescription>{event.title}</DialogDescription>
          </DialogHeader>

          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{event.description}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
