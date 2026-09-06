import { redirect, permanentRedirect } from "next/navigation";

/**
 * The Creatives page became the Library at /library (2026-09 IA pass). Kept as
 * a permanent redirect so existing bookmarks, shared filter URLs and older
 * audit-log links keep working — query params are carried across verbatim, so
 * a link to a filtered list still lands on that same filtered list.
 */
export default async function CreativesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const v of value) qs.append(key, v);
    else if (value !== undefined) qs.set(key, value);
  }
  const query = qs.toString();
  permanentRedirect(query ? `/library?${query}` : "/library");
  // Unreachable — permanentRedirect throws. Satisfies the never-returns lint.
  redirect("/library");
}
