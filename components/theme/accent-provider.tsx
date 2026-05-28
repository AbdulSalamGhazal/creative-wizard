"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  isAccentId,
  type AccentId,
} from "./accents";

interface AccentContextValue {
  accent: AccentId;
  setAccent: (accent: AccentId) => void;
  /** False until the client has read the persisted value (avoids a flash of the wrong picker highlight). */
  mounted: boolean;
}

const AccentContext = createContext<AccentContextValue | null>(null);

/**
 * Manages the brand-accent axis. The actual `data-accent` attribute is set
 * before paint by the inline script in the root layout (no flash); this
 * provider syncs React state to that attribute + localStorage for the picker.
 */
export function AccentProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccentState] = useState<AccentId>(DEFAULT_ACCENT);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const fromDom = document.documentElement.dataset.accent;
    const fromStore =
      typeof window !== "undefined"
        ? window.localStorage.getItem(ACCENT_STORAGE_KEY)
        : null;
    const initial = fromDom ?? fromStore;
    if (isAccentId(initial)) setAccentState(initial);
    setMounted(true);
  }, []);

  const setAccent = useCallback((next: AccentId) => {
    setAccentState(next);
    document.documentElement.dataset.accent = next;
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the attribute still applies for the session.
    }
  }, []);

  return (
    <AccentContext.Provider value={{ accent, setAccent, mounted }}>
      {children}
    </AccentContext.Provider>
  );
}

export function useAccent(): AccentContextValue {
  const ctx = useContext(AccentContext);
  if (!ctx) throw new Error("useAccent must be used within an AccentProvider");
  return ctx;
}
