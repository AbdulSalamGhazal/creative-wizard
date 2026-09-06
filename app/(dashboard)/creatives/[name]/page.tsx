import { redirect, permanentRedirect } from "next/navigation";

/**
 * Creative detail moved to /library/[name] (2026-09 IA pass). Permanent
 * redirect, preserving both the creative name and the list-context params
 * (filters/sort) the detail pager relies on.
 */
export default async function CreativeDetailRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) for (const v of value) qs.append(key, v);
    else if (value !== undefined) qs.set(key, value);
  }
  const query = qs.toString();
  const target = `/library/${encodeURIComponent(name)}`;
  permanentRedirect(query ? `${target}?${query}` : target);
  redirect(target);
}
