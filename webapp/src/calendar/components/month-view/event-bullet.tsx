import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

import type { TEventColor } from "@/calendar/types";

const eventBulletVariants = cva("size-2 rounded-full", {
  variants: {
    color: {
      blue: "bg-blue-600 dark:bg-blue-500",
      green: "bg-green-600 dark:bg-green-500",
      red: "bg-red-600 dark:bg-red-500",
      yellow: "bg-yellow-600 dark:bg-yellow-500",
      purple: "bg-purple-600 dark:bg-purple-500",
      gray: "bg-neutral-600 dark:bg-neutral-500",
      orange: "bg-orange-600 dark:bg-orange-500",
    },
  },
  defaultVariants: {
    color: "blue",
  },
});

export function EventBullet({ color, className, title }: { color: TEventColor; className: string; title?: string }) {
  // Below `lg` this dot replaces the titled badge entirely, so without a name
  // a screen-reader user is told nothing about the day's events at all.
  return <div role="img" aria-label={title ? `Event: ${title}` : "Event"} data-event-bullet="" className={cn(eventBulletVariants({ color, className }))} />;
}
