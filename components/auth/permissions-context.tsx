"use client";

import { createContext, useContext, useMemo } from "react";
import type { Permission } from "@/lib/permissions";

/**
 * The signed-in user's effective permission set, made available to Client
 * Components so they can hide affordances the user can't act on. This mirrors
 * the server's `can()` — the server IS the security boundary, so this is a UX
 * layer only (hiding a button never grants or denies anything on its own).
 */
const PermissionsContext = createContext<ReadonlySet<string>>(new Set());

export function PermissionsProvider({
  granted,
  children,
}: {
  granted: string[];
  children: React.ReactNode;
}) {
  const set = useMemo(() => new Set(granted), [granted]);
  return (
    <PermissionsContext.Provider value={set}>
      {children}
    </PermissionsContext.Provider>
  );
}

/** Whether the current user holds `perm`. Use to gate rendered UI. */
export function useCan(perm: Permission): boolean {
  return useContext(PermissionsContext).has(perm);
}

/** The full effective permission set (for gating on several perms at once). */
export function usePermissions(): ReadonlySet<string> {
  return useContext(PermissionsContext);
}
