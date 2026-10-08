import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AUTHORIZE_PATH } from "@/lib/oauth";
import { readAuthorizeParams, resolveAuthorizeRequest } from "@/lib/oauth-authorize";
import { ConsentForm } from "@/components/account/oauth-consent-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect an app" };

/**
 * The consent screen — the app's own UI, in the sign-in layout rather than the
 * dashboard chrome: this page asks one question and must not look like a place
 * to browse.
 *
 * It RE-VALIDATES the request from the URL instead of trusting that
 * `/api/oauth/authorize` already did, because this address can be typed, shared
 * or replayed. An invalid request renders a refusal here and never bounces
 * anywhere — the redirect only exists once the user has decided.
 */
export default async function OauthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") query.set(k, v);
    else if (Array.isArray(v) && typeof v[0] === "string") query.set(k, v[0]);
  }

  const me = await auth();
  if (!me) {
    // Back through the authorize endpoint, which owns the sign-in bounce.
    redirect(`${AUTHORIZE_PATH}?${query.toString()}`);
  }

  const params = readAuthorizeParams(
    new URL(`https://placeholder.invalid/consent?${query.toString()}`),
  );
  const check = await resolveAuthorizeRequest(params);

  if (check.kind !== "ok") {
    return (
      <div className="w-full max-w-md rounded-lg border border-neg/30 bg-neg/5 p-5">
        <h1 className="text-sm font-medium text-ink">This request can’t be approved</h1>
        <p className="mt-2 text-xs text-ink-2">
          {check.kind === "page_error" ? check.detail : check.description}
        </p>
        <p className="mt-2 text-[11px] text-ink-3">
          Nothing was shared. Start the connection again from the app you were
          connecting.
        </p>
      </div>
    );
  }

  return (
    <ConsentForm
      query={query.toString()}
      clientName={check.client.clientName}
      userEmail={me.email}
      userName={me.name}
      redirectUri={params.redirectUri}
    />
  );
}
