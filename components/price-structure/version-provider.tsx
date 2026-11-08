"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  bootstrapVersion,
  createVersion,
  deleteVersion,
  openVersion,
  pollVersions,
  saveVersion,
} from "@/app/actions/price-structure";
import type { VersionRow, VersionSummary } from "@/db/queries/price-structure";
import type { CreateVersionInput } from "@/validators/price-structure";
import { safeAction } from "@/lib/action-failure";
import { CommentAnchor } from "@/components/comments/comment-anchor-context";
import { toastActionFailure } from "@/lib/action-toast";
import { useNavTransition } from "@/lib/nav-progress";
import { actionSettled } from "@/lib/router-queue";
import { shallowParams } from "@/lib/shallow-url";
import type { VersionData } from "@/price-structure/engine/types";
import type { PriceStructureAccess } from "@/lib/price-structure-access";
import { SAVE_CONFLICT_MESSAGE, VERSION_GONE_MESSAGE } from "@/price-structure/messages";
import { mergeOnConflict, type VersionDoc } from "./merge";

/**
 * The open version and everything that keeps it right (brief §7).
 *
 * Lives in the module's layout, so the state outlives a tab switch: the
 * open version, the edits not yet saved, the autosave timer. The URL's `?v=`
 * says which version THIS browser tab shows; a bare URL opens the version the
 * user opened last, then the most recently opened one, then — for a brand with
 * none — a Blank "Main".
 *
 * Saving: every edit lands in state at once (the pages recalculate as you
 * type) and is saved 500 ms after the last keystroke with the revision the
 * copy was based on. A refused save is merged three-way by section
 * (`merge.ts`); only an edit the server also changed makes us take the server
 * copy, and then we say so. Other tabs and people are caught up with by a poll
 * every 10 s while the tab is visible, and on focus.
 */
export type SaveState = "saved" | "dirty" | "saving" | "retrying" | "failed";

export const AUTOSAVE_MS = 500;
export const POLL_MS = 10_000;
const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 10_000];
const MAX_MERGES = 3;

interface Ctx {
  /** What this member may change (the server decides; this hides or disables controls). */
  access: PriceStructureAccess;
  /** Every version of the brand, most recently opened first. */
  versions: VersionRow[];
  open: VersionRow | null;
  saveState: SaveState;
  /** Edit the open version's document. `path` names the section(s) the edit touches (merge.ts). */
  updateData: (path: string | string[], fn: (data: VersionData) => VersionData) => void;
  /** Rename the open version / change its notes. */
  updateMeta: (patch: Partial<Pick<VersionRow, "name" | "notes">>) => void;
  /** Open another version in THIS tab. */
  switchTo: (id: string) => void;
  openInNewTab: (id: string) => void;
  create: (input: CreateVersionInput) => Promise<{ version: VersionRow; warnings: string[] } | null>;
  remove: (id: string) => Promise<boolean>;
  /** Save whatever is pending now and wait for it. */
  flush: () => Promise<void>;
  /** Try the last failed save again. */
  retry: () => void;
}

const VersionContext = createContext<Ctx | null>(null);

export function useVersion(): Ctx {
  const ctx = useContext(VersionContext);
  if (!ctx) throw new Error("useVersion outside <VersionProvider>");
  return ctx;
}

/** The open version's document, for pages (null while bootstrapping). */
export function useOpenVersion(): VersionRow | null {
  return useVersion().open;
}

/** What this member may change. */
export function useAccess(): PriceStructureAccess {
  return useVersion().access;
}

const byOpened = (a: VersionSummary, b: VersionSummary) =>
  b.openedAt.localeCompare(a.openedAt) || b.createdAt.localeCompare(a.createdAt);

const docOf = (r: VersionRow): VersionDoc => ({ name: r.name, notes: r.notes, data: r.data });

export function VersionProvider({
  initialRows,
  lastOpenedId,
  access,
  children,
}: {
  initialRows: VersionRow[];
  lastOpenedId: string | null;
  access: PriceStructureAccess;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("v");
  const [, startNav] = useNavTransition();

  const [rows, setRows] = useState<VersionRow[]>(() => [...initialRows].sort(byOpened));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const [openId, setOpenId] = useState<string | null>(null);
  const openIdRef = useRef<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");

  // ── Autosave machinery (refs: none of it should re-render the page) ──────
  /** The last copy the server acknowledged for the open version. */
  const baseRef = useRef<(VersionDoc & { id: string; revision: number }) | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const attemptRef = useRef(0);
  const mergesRef = useRef(0);
  const bootstrappingRef = useRef(false);
  const lastTouchedRef = useRef<string | null>(null);

  const patchRow = useCallback((id: string, fn: (r: VersionRow) => VersionRow) => {
    setRows((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
  }, []);

  const setOpen = useCallback(
    (id: string) => {
      const row = rowsRef.current.find((r) => r.id === id);
      if (!row) return;
      openIdRef.current = id;
      setOpenId(id);
      baseRef.current = { id, revision: row.revision, ...docOf(row) };
      pendingRef.current = new Set();
      attemptRef.current = 0;
      mergesRef.current = 0;
      setSaveState("saved");
      const url = new URL(window.location.href);
      if (url.searchParams.get("v") !== id) shallowParams((p) => p.set("v", id), "replace");
      if (lastTouchedRef.current !== id) {
        lastTouchedRef.current = id;
        // Best-effort, like a preference write: the page is open either way.
        void safeAction(() => openVersion({ id }));
      }
    },
    [],
  );

  const fallbackId = useCallback((): string | null => {
    const list = rowsRef.current;
    if (lastOpenedId && list.some((r) => r.id === lastOpenedId)) return lastOpenedId;
    return list[0]?.id ?? null;
  }, [lastOpenedId]);

  const bootstrap = useCallback(async () => {
    if (bootstrappingRef.current) return;
    bootstrappingRef.current = true;
    const res = await safeAction(() => bootstrapVersion());
    bootstrappingRef.current = false;
    if (!res.ok) {
      toastActionFailure(res, "Couldn't open Pricing");
      return;
    }
    const version = res.version;
    setRows((prev) => (prev.some((r) => r.id === version.id) ? prev : [version, ...prev].sort(byOpened)));
    rowsRef.current = rowsRef.current.some((r) => r.id === version.id)
      ? rowsRef.current
      : [version, ...rowsRef.current];
    setOpen(version.id);
  }, [setOpen]);

  // ── Which version this tab shows ─────────────────────────────────────────
  useEffect(() => {
    const current = openIdRef.current;
    const exists = (id: string | null) => id !== null && rows.some((r) => r.id === id);
    if (requested && exists(requested)) {
      if (current !== requested) setOpen(requested);
      return;
    }
    if (exists(current)) {
      // A link that dropped `?v=` (or named a version that is gone) keeps the
      // version this tab already has open; only the address bar is corrected.
      if (requested && requested !== current) toast.message(VERSION_GONE_MESSAGE);
      shallowParams((p) => p.set("v", current!), "replace");
      return;
    }
    if (requested) toast.message(VERSION_GONE_MESSAGE);
    const next = fallbackId();
    if (next) setOpen(next);
    else void bootstrap();
  }, [requested, rows, setOpen, fallbackId, bootstrap]);

  // ── Saving ───────────────────────────────────────────────────────────────
  const runSave = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const id = openIdRef.current;
    const base = baseRef.current;
    const row = id ? rowsRef.current.find((r) => r.id === id) : undefined;
    if (!id || !base || base.id !== id || !row) return Promise.resolve();
    const paths = [...pendingRef.current];
    if (paths.length === 0) {
      setSaveState("saved");
      return Promise.resolve();
    }
    pendingRef.current = new Set();
    setSaveState("saving");
    const snapshot = row;
    const job = (async () => {
      const res = await safeAction(() =>
        saveVersion({ id, revision: base.revision, name: snapshot.name, notes: snapshot.notes, data: snapshot.data }),
      );
      inFlightRef.current = null;
      if (openIdRef.current !== id) return; // switched away meanwhile; the next open re-bases
      if (res.ok) {
        baseRef.current = { id, revision: res.revision, ...docOf(snapshot) };
        patchRow(id, (r) => ({ ...r, revision: res.revision, updatedAt: res.updatedAt }));
        attemptRef.current = 0;
        mergesRef.current = 0;
        if (pendingRef.current.size > 0) void runSave();
        else setSaveState("saved");
        return;
      }
      if ("conflict" in res && res.conflict) {
        const server = res.conflict;
        const localNow = rowsRef.current.find((r) => r.id === id) ?? snapshot;
        const allPaths = [...new Set([...paths, ...pendingRef.current])];
        const out = mergeOnConflict(base, docOf(localNow), docOf(server), allPaths);
        baseRef.current = { id, revision: server.revision, ...docOf(server) };
        if (out.kind === "reapplied" && mergesRef.current < MAX_MERGES) {
          mergesRef.current += 1;
          pendingRef.current = new Set(allPaths);
          patchRow(id, () => ({ ...server, ...out.doc }));
          void runSave();
        } else {
          mergesRef.current = 0;
          pendingRef.current = new Set();
          patchRow(id, () => server);
          setSaveState("saved");
          toast.message(SAVE_CONFLICT_MESSAGE);
        }
        return;
      }
      if ("gone" in res && res.gone) {
        pendingRef.current = new Set();
        setSaveState("saved");
        setRows((prev) => prev.filter((r) => r.id !== id));
        rowsRef.current = rowsRef.current.filter((r) => r.id !== id);
        toast.message(VERSION_GONE_MESSAGE);
        const next = fallbackId();
        if (next) setOpen(next);
        else void bootstrap();
        return;
      }
      // The call failed (network, deploy skew) or the server refused: keep the
      // edits pending and try again with a growing pause, up to a point.
      pendingRef.current = new Set([...paths, ...pendingRef.current]);
      if ("stale" in res && res.stale) toastActionFailure(res, "Couldn't save");
      const attempt = attemptRef.current;
      if (attempt < RETRY_MS.length) {
        attemptRef.current = attempt + 1;
        setSaveState("retrying");
        timerRef.current = setTimeout(() => void runSave(), RETRY_MS[attempt]);
      } else {
        setSaveState("failed");
        toast.error(res.error || "Couldn't save");
      }
    })();
    inFlightRef.current = job;
    return job;
  }, [patchRow, fallbackId, setOpen, bootstrap]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void runSave(), AUTOSAVE_MS);
  }, [runSave]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await runSave();
    if (inFlightRef.current) await inFlightRef.current;
  }, [runSave]);

  const retry = useCallback(() => {
    attemptRef.current = 0;
    void flush();
  }, [flush]);

  const updateData = useCallback(
    (path: string | string[], fn: (data: VersionData) => VersionData) => {
      const id = openIdRef.current;
      if (!id || !access.edit) return;
      for (const p of typeof path === "string" ? [path] : path) pendingRef.current.add(p);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, data: fn(r.data) } : r)));
      setSaveState("dirty");
      scheduleSave();
    },
    [scheduleSave, access.edit],
  );

  const updateMeta = useCallback(
    (patch: Partial<Pick<VersionRow, "name" | "notes">>) => {
      const id = openIdRef.current;
      if (!id || !access.versions) return;
      if (patch.name !== undefined) pendingRef.current.add("name");
      if (patch.notes !== undefined) pendingRef.current.add("notes");
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      setSaveState("dirty");
      scheduleSave();
    },
    [scheduleSave, access.versions],
  );

  // Leaving with unsaved edits: the browser's own "are you sure" is the only
  // thing that can stop a tab close mid-debounce.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingRef.current.size > 0 || inFlightRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // ── Catching up with other tabs and people ───────────────────────────────
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (stopped || document.hidden) return;
      if (inFlightRef.current || pendingRef.current.size > 0) return;
      const known = rowsRef.current.map((r) => ({ id: r.id, revision: r.revision }));
      const res = await safeAction(() => pollVersions({ known }));
      if (stopped || !res.ok) return; // a missed poll is nothing to report
      if (inFlightRef.current || pendingRef.current.size > 0) return; // edits landed meanwhile
      const changed = new Map(res.changed.map((c) => [c.id, c]));
      const deleted = new Set(res.deleted);
      const summaries = new Map(res.summaries.map((s) => [s.id, s]));
      const current = openIdRef.current;
      setRows((prev) => {
        const next = prev
          .filter((r) => !deleted.has(r.id))
          .map((r) => changed.get(r.id) ?? (summaries.has(r.id) ? { ...r, openedAt: summaries.get(r.id)!.openedAt } : r));
        for (const c of res.changed) if (!prev.some((r) => r.id === c.id)) next.push(c);
        next.sort(byOpened);
        rowsRef.current = next;
        return next;
      });
      if (current && changed.has(current)) {
        const row = changed.get(current)!;
        baseRef.current = { id: current, revision: row.revision, ...docOf(row) };
      }
      if (current && deleted.has(current)) {
        toast.message(VERSION_GONE_MESSAGE);
        const next = fallbackId();
        if (next) setOpen(next);
        else void bootstrap();
      }
    };
    const onFocus = () => {
      if (!document.hidden) void poll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const interval = setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(interval);
    };
  }, [fallbackId, setOpen, bootstrap]);

  // ── Versions ─────────────────────────────────────────────────────────────
  const switchTo = useCallback(
    (id: string) => {
      void (async () => {
        await flush();
        await actionSettled();
        startNav(() => router.push(`${pathname}?v=${id}`));
      })();
    },
    [flush, pathname, router, startNav],
  );

  const openInNewTab = useCallback(
    (id: string) => {
      window.open(`/price-structure/overview?v=${id}`, "_blank", "noopener");
    },
    [],
  );

  const create = useCallback(async (input: CreateVersionInput) => {
    const res = await safeAction(() => createVersion(input));
    if (!res.ok) {
      toastActionFailure(res, "Couldn't create the version");
      return null;
    }
    setRows((prev) => {
      const next = [res.version, ...prev.filter((r) => r.id !== res.version.id)].sort(byOpened);
      rowsRef.current = next;
      return next;
    });
    return { version: res.version, warnings: res.warnings };
  }, []);

  const remove = useCallback(
    async (id: string) => {
      const res = await safeAction(() => deleteVersion({ id }));
      if (!res.ok) {
        toastActionFailure(res, "Couldn't delete the version");
        return false;
      }
      setRows((prev) => {
        const next = prev.filter((r) => r.id !== id);
        rowsRef.current = next;
        return next;
      });
      if (openIdRef.current === id) {
        const next = fallbackId();
        if (next) setOpen(next);
        else void bootstrap();
      }
      return true;
    },
    [fallbackId, setOpen, bootstrap],
  );

  const open = useMemo(() => rows.find((r) => r.id === openId) ?? null, [rows, openId]);

  const value = useMemo<Ctx>(
    () => ({ access, versions: rows, open, saveState, updateData, updateMeta, switchTo, openInNewTab, create, remove, flush, retry }),
    [access, rows, open, saveState, updateData, updateMeta, switchTo, openInNewTab, create, remove, flush, retry],
  );

  return (
    <VersionContext.Provider value={value}>
      {/* The open version is what the rail's Comments and Activity are about
          (2026-11-07) — on every page of the module, re-registered as `?v=`
          switches. */}
      {open && <CommentAnchor type="ps_version" id={open.id} />}
      {children}
    </VersionContext.Provider>
  );
}
