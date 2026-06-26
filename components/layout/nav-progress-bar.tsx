"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { navProgress } from "@/lib/nav-progress";

/**
 * A thin brand-colored bar pinned to the very top of the app that shows while a
 * navigation (filter / date / sort change) is in flight. It trickles toward 90%
 * while pending, then snaps to 100% and fades when the new page commits. Driven
 * by the shared `navProgress` store (fed by `useNavTransition`) — App Router has
 * no route-change events, and same-route transitions show no loading state on
 * their own.
 */
export function NavProgressBar() {
  const active = useSyncExternalStore(
    navProgress.subscribe,
    navProgress.isActive,
    () => false,
  );
  const [width, setWidth] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (active) {
      setShow(true);
      setWidth(8);
      // Next frame → let the slow CSS transition creep toward 90%.
      const id = requestAnimationFrame(() => setWidth(90));
      return () => cancelAnimationFrame(id);
    }
    // Completed — only "finish" if we'd actually started.
    setWidth((cur) => (cur > 0 ? 100 : 0));
    const t1 = setTimeout(() => setShow(false), 250);
    const t2 = setTimeout(() => setWidth(0), 450);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [active]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-0.5"
    >
      <div
        className="h-full rounded-r-full bg-brand shadow-[0_0_10px_var(--brand)]"
        style={{
          width: `${width}%`,
          opacity: show ? 1 : 0,
          transition: active
            ? "width 12s cubic-bezier(0.05, 0.7, 0.4, 1)"
            : "width 200ms ease-out, opacity 250ms ease-out 150ms",
        }}
      />
    </div>
  );
}
