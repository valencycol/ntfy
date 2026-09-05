import { useCalendar } from "@/calendar/contexts/calendar-context";

import { api, eventToPayload } from "@/lib/api";

import type { IEvent } from "@/calendar/interfaces";

/**
 * Used by drag-and-drop, which moves an event to a new day or time slot. The
 * move is applied locally first so the drop feels instant, then persisted; if
 * the Worker rejects it, a refresh puts the event back where it was.
 */
export function useUpdateEvent() {
  const { setLocalEvents, refreshEvents } = useCalendar();

  const updateEvent = (event: IEvent) => {
    setLocalEvents(prev => {
      const index = prev.findIndex(e => e.id === event.id);
      if (index === -1) return prev;
      return [...prev.slice(0, index), event, ...prev.slice(index + 1)];
    });

    void api(`/api/events/${event.eventId}`, { method: "PATCH", body: JSON.stringify(eventToPayload(event)) }).catch(() => refreshEvents());
  };

  return { updateEvent };
}
