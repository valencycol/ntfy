import { z } from "zod";

const timeValue = z.object({ hour: z.number(), minute: z.number() });

export const eventSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string(),
    allDay: z.boolean(),
    startDate: z.date({ required_error: "Start date is required" }),
    startTime: timeValue.optional(),
    endDate: z.date({ required_error: "End date is required" }),
    endTime: timeValue.optional(),
    color: z.enum(["blue", "green", "red", "yellow", "purple", "orange", "gray"], { required_error: "Color is required" }),
    repeatYearly: z.boolean(),
    reminderTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM")).max(5, "Up to 5 reminder times"),
  })
  .superRefine((data, ctx) => {
    // All-day events compare by date alone; timed events need the clock too.
    if (data.allDay) {
      if (data.endDate < data.startDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End date cannot be before start date", path: ["endDate"] });
      }
      return;
    }

    if (!data.startTime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Start time is required", path: ["startTime"] });
    }
    if (!data.endTime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End time is required", path: ["endTime"] });
    }
    if (!data.startTime || !data.endTime) return;

    const start = new Date(data.startDate);
    start.setHours(data.startTime.hour, data.startTime.minute, 0, 0);

    const end = new Date(data.endDate);
    end.setHours(data.endTime.hour, data.endTime.minute, 0, 0);

    if (start >= end) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End must be after start", path: ["endDate"] });
    }
  });

export type TEventFormData = z.infer<typeof eventSchema>;
