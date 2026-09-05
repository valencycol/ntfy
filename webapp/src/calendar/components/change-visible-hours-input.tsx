"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Info } from "lucide-react";

import { useCalendar } from "@/calendar/contexts/calendar-context";

import { Button } from "@/components/ui/button";
import { TimeInput } from "@/components/ui/time-input";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

import type { TimeValue } from "react-aria-components";

export function ChangeVisibleHoursInput() {
  const { visibleHours, setVisibleHours } = useCalendar();

  const [from, setFrom] = useState<{ hour: number; minute: number }>({ hour: visibleHours.from, minute: 0 });
  const [to, setTo] = useState<{ hour: number; minute: number }>({ hour: visibleHours.to, minute: 0 });

  // Applying only changes the grid behind the dialog, so without an
  // acknowledgement the button looks inert.
  const [applied, setApplied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleApply = () => {
    const toHour = to.hour === 0 ? 24 : to.hour;
    setVisibleHours({ from: from.hour, to: toHour });

    setApplied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setApplied(false), 2500);
  };

  const label = (hour: number) => {
    const suffix = hour < 12 || hour === 24 ? "am" : "pm";
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelve}${suffix}`;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">Change visible hours</p>

        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger>
              <Info className="size-3" />
            </TooltipTrigger>

            <TooltipContent className="max-w-80 text-center">
              <p>If an event falls outside the specified visible hours, the visible hours will automatically adjust to include that event.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="flex items-center gap-4">
        <p>From</p>
        <TimeInput id="start-time" hourCycle={12} granularity="hour" value={from as TimeValue} onChange={setFrom as (value: TimeValue | null) => void} />
        <p>To</p>
        <TimeInput id="end-time" hourCycle={12} granularity="hour" value={to as TimeValue} onChange={setTo as (value: TimeValue | null) => void} />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button className="w-fit" onClick={handleApply}>
          Apply
        </Button>

        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {applied && (
            <span className="flex items-center gap-1.5 font-medium text-green-600 dark:text-green-500">
              <Check className="size-4" />
              Showing {label(visibleHours.from)} to {label(visibleHours.to)}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
