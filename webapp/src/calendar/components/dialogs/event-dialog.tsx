"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Time } from "@internationalized/date";
import { addDays, differenceInCalendarDays } from "date-fns";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bell, Plus, Trash2, X } from "lucide-react";

import { useDisclosure } from "@/hooks/use-disclosure";
import { useCalendar } from "@/calendar/contexts/calendar-context";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput } from "@/components/ui/time-input";
import { SingleDayPicker } from "@/components/ui/single-day-picker";
import { Form, FormField, FormLabel, FormItem, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectItem, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogHeader, DialogClose, DialogContent, DialogTrigger, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

import { api, eventToPayload, nameToHex } from "@/lib/api";
import { eventSchema } from "@/calendar/schemas";

import type { TimeValue } from "react-aria-components";
import type { IEvent } from "@/calendar/interfaces";
import type { TEventColor } from "@/calendar/types";
import type { TEventFormData } from "@/calendar/schemas";

const COLORS: { value: TEventColor; label: string }[] = [
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "red", label: "Red" },
  { value: "yellow", label: "Yellow" },
  { value: "purple", label: "Purple" },
  { value: "orange", label: "Orange" },
  { value: "gray", label: "Gray" },
];

/** Midnight and 9am, the two the Worker has always defaulted imports to. */
const DEFAULT_REMINDERS = ["00:00", "09:00"];
const MAX_REMINDERS = 5;
const PRE_START_MINUTES = 15;
/** Used when an event has no length to preserve yet. */
const DEFAULT_DURATION_MINUTES = 60;

function toDate(iso: string) {
  return new Date(iso);
}

function hhmm(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function minusMinutes(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m - minutes + 1440) % 1440;
  return hhmm(Math.floor(total / 60), total % 60);
}

function prettyTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function defaultsFor(event: IEvent | undefined, startDate: Date | undefined, startTime: { hour: number; minute: number } | undefined): TEventFormData {
  if (event) {
    const start = toDate(event.startDate);
    const end = toDate(event.endDate);
    return {
      title: event.title,
      description: event.description,
      allDay: event.allDay,
      startDate: start,
      startTime: event.allDay ? undefined : { hour: start.getHours(), minute: start.getMinutes() },
      endDate: end,
      endTime: event.allDay ? undefined : { hour: end.getHours(), minute: end.getMinutes() },
      color: event.color,
      repeatYearly: event.repeatYearly,
      reminderTimes: event.reminderTimes,
    };
  }

  const base = startDate ?? new Date();
  return {
    title: "",
    description: "",
    allDay: !startTime,
    startDate: base,
    startTime,
    endDate: base,
    endTime: startTime ? { hour: (startTime.hour + 1) % 24, minute: startTime.minute } : undefined,
    color: "blue",
    repeatYearly: false,
    reminderTimes: [...DEFAULT_REMINDERS],
  };
}

interface IProps {
  /** Trigger element. Omit when driving the dialog with `open`/`onOpenChange`. */
  children?: React.ReactNode;
  /** Present when editing; absent when creating. */
  event?: IEvent;
  startDate?: Date;
  startTime?: { hour: number; minute: number };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function EventDialog({ children, event, startDate, startTime, open: openProp, onOpenChange }: IProps) {
  const { refreshEvents, superuser } = useCalendar();
  const uncontrolled = useDisclosure();

  const isControlled = openProp !== undefined;
  const isOpen = isControlled ? openProp : uncontrolled.isOpen;
  const onToggle = isControlled ? () => onOpenChange?.(!openProp) : uncontrolled.onToggle;
  const onClose = isControlled ? () => onOpenChange?.(false) : uncontrolled.onClose;

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newReminder, setNewReminder] = useState("");

  const form = useForm<TEventFormData>({
    resolver: zodResolver(eventSchema),
    defaultValues: defaultsFor(event, startDate, startTime),
  });

  // Naming a new event is always allowed; changing an existing one's name is
  // not, so a stray edit cannot quietly retitle something.
  const renameLocked = !!event && !superuser;

  const allDay = form.watch("allDay");
  const watchedStartDate = form.watch("startDate");
  const watchedEndDate = form.watch("endDate");
  const watchedStartTime = form.watch("startTime");
  const watchedEndTime = form.watch("endTime");
  const reminderTimes = form.watch("reminderTimes");

  // Moving the start drags the end along, keeping the length of the event.
  // Leaving the end behind on today's date when the start jumps three weeks
  // out is never what was meant.
  const previousStartDate = useRef<Date | null>(null);
  const previousDuration = useRef<number | null>(null);

  // Re-seed the form whenever the dialog opens, so an edit dialog reopened
  // after an external refresh shows current values rather than stale ones.
  useEffect(() => {
    if (!isOpen) return;
    const seed = defaultsFor(event, startDate, startTime);
    form.reset(seed);
    previousStartDate.current = seed.startDate;
    previousDuration.current =
      seed.startTime && seed.endTime
        ? (seed.endTime.hour * 60 + seed.endTime.minute) - (seed.startTime.hour * 60 + seed.startTime.minute)
        : null;
    setSubmitError("");
    setConfirmDelete(false);
    setNewReminder("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, event, startDate, startTime]);

  // Start date moved: carry the end date with it, preserving the span.
  useEffect(() => {
    if (!isOpen || !watchedStartDate) return;

    const previous = previousStartDate.current;
    previousStartDate.current = watchedStartDate;
    if (!previous || differenceInCalendarDays(watchedStartDate, previous) === 0) return;

    const currentEnd = form.getValues("endDate");
    const span = currentEnd ? Math.max(differenceInCalendarDays(currentEnd, previous), 0) : 0;
    form.setValue("endDate", addDays(watchedStartDate, span), { shouldDirty: true, shouldValidate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedStartDate, isOpen]);

  // The mirror of the rule above: dragging the end before the start pulls the
  // start back with it, rather than leaving an impossible range on screen.
  useEffect(() => {
    if (!isOpen) return;
    const end = form.getValues("endDate");
    if (!watchedEndDate || !watchedStartDate || !end) return;
    if (differenceInCalendarDays(watchedEndDate, watchedStartDate) >= 0) return;

    previousStartDate.current = watchedEndDate;
    form.setValue("startDate", watchedEndDate, { shouldDirty: true, shouldValidate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedEndDate, isOpen]);

  // Start time moved: keep the meeting the same length rather than leaving an
  // end time that is now before the start.
  useEffect(() => {
    if (!isOpen || allDay || !watchedStartTime) return;

    const startMinutes = watchedStartTime.hour * 60 + watchedStartTime.minute;
    const duration = previousDuration.current ?? DEFAULT_DURATION_MINUTES;
    const endMinutes = (startMinutes + (duration > 0 ? duration : DEFAULT_DURATION_MINUTES)) % 1440;
    const next = { hour: Math.floor(endMinutes / 60), minute: endMinutes % 60 };

    const currentEnd = form.getValues("endTime");
    if (currentEnd && currentEnd.hour === next.hour && currentEnd.minute === next.minute) return;
    form.setValue("endTime", next, { shouldDirty: true, shouldValidate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedStartTime?.hour, watchedStartTime?.minute, allDay, isOpen]);

  // Editing the end time directly redefines the length to preserve from then on.
  useEffect(() => {
    if (!isOpen || allDay || !watchedStartTime || !watchedEndTime) return;
    previousDuration.current =
      (watchedEndTime.hour * 60 + watchedEndTime.minute) - (watchedStartTime.hour * 60 + watchedStartTime.minute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedEndTime?.hour, watchedEndTime?.minute]);

  // A timed event gets a reminder 15 minutes before it starts, kept in sync as
  // the start time is edited. Only the entry this added is replaced — reminders
  // typed by hand are left alone.
  const autoReminder = useRef<string | null>(event && !event.allDay && watchedStartTime ? minusMinutes(hhmm(watchedStartTime.hour, watchedStartTime.minute), PRE_START_MINUTES) : null);

  useEffect(() => {
    if (!isOpen) return;
    const current = form.getValues("reminderTimes");
    const withoutAuto = autoReminder.current ? current.filter(t => t !== autoReminder.current) : current;

    if (allDay || !watchedStartTime) {
      autoReminder.current = null;
      if (withoutAuto.length !== current.length) form.setValue("reminderTimes", withoutAuto, { shouldDirty: true });
      return;
    }

    const pre = minusMinutes(hhmm(watchedStartTime.hour, watchedStartTime.minute), PRE_START_MINUTES);
    autoReminder.current = pre;
    const next = withoutAuto.includes(pre) || withoutAuto.length >= MAX_REMINDERS ? withoutAuto : [...withoutAuto, pre].sort();
    if (next.join() !== current.join()) form.setValue("reminderTimes", next, { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDay, watchedStartTime?.hour, watchedStartTime?.minute, isOpen]);

  const addReminder = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(newReminder)) return;
    const current = form.getValues("reminderTimes");
    if (current.includes(newReminder) || current.length >= MAX_REMINDERS) return;
    form.setValue("reminderTimes", [...current, newReminder].sort(), { shouldDirty: true });
    setNewReminder("");
  };

  const removeReminder = (time: string) => {
    form.setValue(
      "reminderTimes",
      form.getValues("reminderTimes").filter(t => t !== time),
      { shouldDirty: true }
    );
    if (autoReminder.current === time) autoReminder.current = null;
  };

  const onSubmit = async (values: TEventFormData) => {
    setSubmitting(true);
    setSubmitError("");

    const start = new Date(values.startDate);
    const end = new Date(values.endDate);
    if (!values.allDay && values.startTime) start.setHours(values.startTime.hour, values.startTime.minute, 0, 0);
    if (!values.allDay && values.endTime) end.setHours(values.endTime.hour, values.endTime.minute, 0, 0);

    const payload = eventToPayload({
      id: event?.id ?? "",
      eventId: event?.eventId ?? "",
      uid: event?.uid ?? "",
      title: values.title,
      description: values.description ?? "",
      color: values.color,
      allDay: values.allDay,
      repeatYearly: values.repeatYearly,
      reminderTimes: values.reminderTimes,
      user: { id: "me", name: "Me", picturePath: null },
      startDate: `${format(start)}T${values.allDay ? "00:00" : hhmm(start.getHours(), start.getMinutes())}:00`,
      endDate: `${format(end)}T${values.allDay ? "23:59" : hhmm(end.getHours(), end.getMinutes())}:59`,
    });

    try {
      if (event) await api(`/api/events/${event.eventId}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api("/api/events", { method: "POST", body: JSON.stringify(payload) });
      await refreshEvents();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not save the event.");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (!event) return;
    if (!superuser) {
      setSubmitError("Deleting is switched off. Type the superuser command in the search box to enable it.");
      return;
    }
    // Two taps rather than confirm(), which is unreliable in a standalone PWA.
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/events/${event.eventId}`, { method: "DELETE" });
      await refreshEvents();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not delete the event.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={next => (isControlled ? onOpenChange?.(next) : onToggle())}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}

      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "Add event"}</DialogTitle>
          <DialogDescription>Reminders are pushed to ntfy at the times you list below.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form id="event-form" onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
            <FormField
              control={form.control}
              name="title"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel htmlFor="title">Title</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      id="title"
                      placeholder="Enter a title"
                      data-invalid={fieldState.invalid}
                      // After the spread: react-hook-form supplies its own
                      // `disabled`, which would otherwise undo this.
                      disabled={renameLocked}
                      title={renameLocked ? "Renaming needs superuser — enable it from the search box" : undefined}
                    />
                  </FormControl>

                  {renameLocked && <p className="text-xs text-muted-foreground">Renaming needs superuser — enable it from the search box.</p>}

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="allDay"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-3">
                  <FormLabel className="mb-0">All day</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex items-start gap-2">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field, fieldState }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <SingleDayPicker value={field.value} onSelect={date => field.onChange(date as Date)} placeholder="Select a date" data-invalid={fieldState.invalid} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!allDay && (
                <FormField
                  control={form.control}
                  name="startTime"
                  render={({ field, fieldState }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Start time</FormLabel>
                      <FormControl>
                        <TimeInput
                          aria-label="Start time"
                          value={field.value ? new Time(field.value.hour, field.value.minute) : null}
                          onChange={(value: TimeValue | null) => field.onChange(value ? { hour: value.hour, minute: value.minute } : undefined)}
                          hourCycle={12}
                          data-invalid={fieldState.invalid}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <div className="flex items-start gap-2">
              <FormField
                control={form.control}
                name="endDate"
                render={({ field, fieldState }) => (
                  <FormItem className="flex-1">
                    <FormLabel>End date</FormLabel>
                    <FormControl>
                      <SingleDayPicker value={field.value} onSelect={date => field.onChange(date as Date)} placeholder="Select a date" data-invalid={fieldState.invalid} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!allDay && (
                <FormField
                  control={form.control}
                  name="endTime"
                  render={({ field, fieldState }) => (
                    <FormItem className="flex-1">
                      <FormLabel>End time</FormLabel>
                      <FormControl>
                        <TimeInput
                          aria-label="End time"
                          value={field.value ? new Time(field.value.hour, field.value.minute) : null}
                          onChange={(value: TimeValue | null) => field.onChange(value ? { hour: value.hour, minute: value.minute } : undefined)}
                          hourCycle={12}
                          data-invalid={fieldState.invalid}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <FormField
              control={form.control}
              name="color"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Color</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger data-invalid={fieldState.invalid}>
                        <SelectValue placeholder="Select an option" />
                      </SelectTrigger>
                      <SelectContent>
                        {COLORS.map(color => (
                          <SelectItem key={color.value} value={color.value}>
                            <div className="flex items-center gap-2">
                              <div className="size-3.5 rounded-full" style={{ background: nameToHex(color.value) }} />
                              {color.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="repeatYearly"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <FormLabel className="mb-0">Repeats yearly</FormLabel>
                    <p className="text-xs text-muted-foreground">For birthdays and anniversaries.</p>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reminderTimes"
              render={() => (
                <FormItem className="rounded-md border p-3">
                  <FormLabel className="flex items-center gap-2">
                    <Bell className="size-4" />
                    Reminder times
                  </FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Up to {MAX_REMINDERS}, pushed on the day of the event.
                    {!allDay && " A reminder 15 minutes before the start is kept in sync automatically."}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {reminderTimes.length === 0 && <p className="text-xs text-muted-foreground">No reminders — this event will not push.</p>}

                    {reminderTimes.map(time => (
                      <span key={time} className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs font-medium tabular-nums">
                        {prettyTime(time)}
                        <button type="button" aria-label={`Remove reminder at ${prettyTime(time)}`} onClick={() => removeReminder(time)} className="text-muted-foreground hover:text-foreground">
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>

                  {reminderTimes.length < MAX_REMINDERS && (
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="time"
                        aria-label="New reminder time"
                        value={newReminder}
                        onChange={e => setNewReminder(e.target.value)}
                        onKeyDown={e => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          addReminder();
                        }}
                        className="h-9 w-36"
                      />
                      <Button type="button" size="sm" variant="outline" onClick={addReminder} disabled={!newReminder}>
                        <Plus className="size-4" />
                        Add
                      </Button>
                    </div>
                  )}

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} data-invalid={fieldState.invalid} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {submitError && <p className="text-sm font-medium text-destructive">{submitError}</p>}
          </form>
        </Form>

        <DialogFooter className="gap-2 sm:justify-between">
          {event ? (
            <Button
              type="button"
              variant={confirmDelete ? "destructive" : "outline"}
              onClick={onDelete}
              disabled={submitting || !superuser}
              title={superuser ? undefined : "Deleting is switched off — enable superuser from the search box"}
            >
              <Trash2 className="size-4" />
              {confirmDelete ? "Tap again to delete" : "Delete"}
            </Button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>

            <Button form="event-form" type="submit" disabled={submitting}>
              {submitting ? "Saving…" : event ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Local YYYY-MM-DD, deliberately not toISOString() which shifts to UTC. */
function format(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
