"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

type TToastKind = "success" | "error" | "info";

interface IToast {
  id: number;
  kind: TToastKind;
  message: string;
}

interface IToastContext {
  toast: (message: string, kind?: TToastKind) => void;
}

const ToastContext = createContext<IToastContext>({ toast: () => {} });

const DISMISS_AFTER_MS = 4000;

const STYLES: Record<TToastKind, { className: string; icon: typeof Info }> = {
  success: { className: "border-green-600/40 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100", icon: Check },
  error: { className: "border-destructive/50 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100", icon: AlertTriangle },
  info: { className: "border-border bg-popover text-popover-foreground", icon: Info },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<IToast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  const toast = useCallback(
    (message: string, kind: TToastKind = "info") => {
      const id = nextId.current++;
      setToasts(prev => [...prev, { id, kind, message }]);
      setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Bottom-centre on a phone where the thumb is, top-right on a desktop. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-3 bottom-4 z-[100] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:items-end"
      >
        {toasts.map(item => {
          const { className, icon: Icon } = STYLES[item.kind];
          return (
            <div
              key={item.id}
              data-toast={item.kind}
              role={item.kind === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-md border px-3 py-2.5 text-sm shadow-lg",
                "animate-in fade-in slide-in-from-bottom-2 sm:slide-in-from-top-2",
                className
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <p className="flex-1">{item.message}</p>
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(item.id)} className="shrink-0 opacity-60 hover:opacity-100">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext).toast;
}
