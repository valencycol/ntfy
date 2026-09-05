export type TTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "colaco-calendar-theme";
export const DEFAULT_THEME: TTheme = "dark";

/**
 * Runs before first paint, inlined into <head>, so the page never flashes the
 * wrong theme. Kept as a string because it has to execute ahead of hydration.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t!=="light"&&t!=="dark")t=${JSON.stringify(DEFAULT_THEME)};document.documentElement.classList.add(t)}catch(e){document.documentElement.classList.add(${JSON.stringify(DEFAULT_THEME)})}})()`;

export function readTheme(): TTheme {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: TTheme) {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode; the choice just won't survive a reload */
  }
}
