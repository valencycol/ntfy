"use client";

import { useCallback, useEffect, useState } from "react";

import { CalendarProvider } from "@/calendar/contexts/calendar-context";

import { AppBar } from "@/components/app-bar";
import { ToastProvider } from "@/components/toast";
import { LockScreen } from "@/components/lock-screen";

import { api, ApiError } from "@/lib/api";

type TAuth = "checking" | "locked" | "unlocked";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<TAuth>("checking");

  // The session cookie is HttpOnly, so the only way to know whether it is still
  // valid is to ask the Worker. A cheap authenticated endpoint stands in for a
  // dedicated /api/session check.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api("/api/events?from=2000-01-01&to=2000-01-02");
        if (!cancelled) setAuth("unlocked");
      } catch (err) {
        if (!cancelled) setAuth(err instanceof ApiError && err.status === 401 ? "locked" : "unlocked");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSessionExpired = useCallback(() => setAuth("locked"), []);

  if (auth === "checking") return <div className="min-h-dvh" />;
  if (auth === "locked") return <LockScreen onUnlock={() => setAuth("unlocked")} />;

  return (
    <ToastProvider>
      <CalendarProvider onSessionExpired={handleSessionExpired}>
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-4 px-3 py-4 sm:px-8">
          <AppBar />

          {children}
        </div>
      </CalendarProvider>
    </ToastProvider>
  );
}
