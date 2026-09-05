"use client";

import { ChangeBadgeVariantInput } from "@/calendar/components/change-badge-variant-input";
import { ChangeVisibleHoursInput } from "@/calendar/components/change-visible-hours-input";
import { ChangeWorkingHoursInput } from "@/calendar/components/change-working-hours-input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Calendar settings</DialogTitle>
          <DialogDescription>How events are drawn, and which hours the week and day grids show.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-2">
          <ChangeBadgeVariantInput />
          <ChangeVisibleHoursInput />
          <ChangeWorkingHoursInput />
        </div>
      </DialogContent>
    </Dialog>
  );
}
