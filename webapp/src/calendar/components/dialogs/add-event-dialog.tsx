"use client";

import { EventDialog } from "@/calendar/components/dialogs/event-dialog";

interface IProps {
  children: React.ReactNode;
  startDate?: Date;
  startTime?: { hour: number; minute: number };
}

export function AddEventDialog({ children, startDate, startTime }: IProps) {
  return (
    <EventDialog startDate={startDate} startTime={startTime}>
      {children}
    </EventDialog>
  );
}
