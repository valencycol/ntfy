"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { applyTheme, readTheme } from "@/lib/theme";

import type { TTheme } from "@/lib/theme";

export function ToggleTheme() {
  // The class is set by the head bootstrap, so the real theme is only knowable
  // after mount — a skeleton holds the space until then.
  const [theme, setThemeState] = useState<TTheme>();

  useEffect(() => setThemeState(readTheme()), []);

  if (!theme) return <Skeleton className="size-9" />;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => {
        const next: TTheme = theme === "dark" ? "light" : "dark";
        applyTheme(next);
        setThemeState(next);
      }}
    >
      {theme === "dark" ? <Moon /> : <Sun />}
    </Button>
  );
}
