"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  resolveCommentAnchor,
  type CommentAnchor as Anchor,
  type CommentAnchorType,
} from "@/lib/comments";

interface Registration {
  path: string;
  anchor: Anchor;
}

interface AnchorContextValue {
  anchor: Anchor | null;
  register: (registration: Registration) => void;
  unregister: (id: string) => void;
}

const AnchorContext = createContext<AnchorContextValue>({
  anchor: null,
  register: () => {},
  unregister: () => {},
});

/**
 * Which thing the comment drawer is pointing at, for the whole app.
 *
 * Most pages derive their anchor from the pathname (a "view" comment on a
 * nav-listed page). An ENTITY page declares itself instead by rendering
 * `<CommentAnchor>`, which registers the entity and wins for as long as the
 * user is on that path. The registration carries the pathname it was made on,
 * so a stale one from the page just left can never leak onto the next.
 */
export function CommentAnchorProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [entity, setEntity] = useState<Registration | null>(null);

  const register = useCallback((registration: Registration) => {
    setEntity(registration);
  }, []);

  // Ownership check: only the registration that is still current clears
  // itself, so an unmount arriving after the next page registered is a no-op.
  const unregister = useCallback((id: string) => {
    setEntity((current) => (current?.anchor.id === id ? null : current));
  }, []);

  const value = useMemo<AnchorContextValue>(
    () => ({
      anchor: resolveCommentAnchor({ pathname, entity }),
      register,
      unregister,
    }),
    [pathname, entity, register, unregister],
  );

  return <AnchorContext.Provider value={value}>{children}</AnchorContext.Provider>;
}

export function useCommentAnchor(): Anchor | null {
  return useContext(AnchorContext).anchor;
}

/**
 * Declares an entity page's anchor — render it anywhere on the page (it draws
 * nothing). The creative detail page renders `<CommentAnchor type="creative"
 * id={creative.id} />` and the drawer follows.
 */
export function CommentAnchor({
  type,
  id,
}: {
  type: CommentAnchorType;
  id: string;
}) {
  const pathname = usePathname();
  const { register, unregister } = useContext(AnchorContext);

  useEffect(() => {
    register({ path: pathname, anchor: { type, id } });
    return () => unregister(id);
  }, [pathname, type, id, register, unregister]);

  return null;
}
