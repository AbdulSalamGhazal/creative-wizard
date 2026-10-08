"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decideOauthConsent } from "@/app/actions/oauth";

/**
 * Allow / Deny. Deliberately plain: it names the app, the account it would act
 * as, what it may do, and where the answer goes — and nothing else competes for
 * attention. There is no "remember this" shortcut; a connection is a thing the
 * user can see and revoke afterwards on /account/api.
 *
 * Both buttons go through ONE server action, which re-validates the request and
 * returns the URL to visit. The hop is a full navigation (`location.assign`)
 * rather than a router push: the destination is another origin, and it carries
 * the authorization code.
 */
export function ConsentForm({
  query,
  clientName,
  userEmail,
  userName,
  redirectUri,
}: {
  query: string;
  clientName: string;
  userEmail: string;
  userName: string;
  redirectUri: string;
}) {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Just the host — the full callback URL is noise to a reader, and the host is
  // the part that tells them whether this is who they think it is.
  const host = (() => {
    try {
      return new URL(redirectUri).host;
    } catch {
      return redirectUri;
    }
  })();

  async function decide(decision: "allow" | "deny") {
    setBusy(decision);
    setError(null);
    const res = await decideOauthConsent({ query, decision });
    if (!res.ok || !res.redirectTo) {
      setError(res.error ?? "Something went wrong. Start the connection again.");
      setBusy(null);
      return;
    }
    window.location.assign(res.redirectTo);
  }

  return (
    <div className="w-full max-w-md rounded-lg border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-md border border-line bg-surface-2 p-2 text-ink-2">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="text-sm font-medium text-ink">
            Connect <span className="text-brand">{clientName}</span> to Wizard?
          </h1>
          <p className="mt-1 text-xs text-ink-2">
            It will read Wizard analytics as{" "}
            <span className="text-ink">{userName}</span> ({userEmail}) — the same
            brands and data you can see, and nothing more.
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-1.5 rounded-md border border-line bg-surface-2 p-3 text-xs text-ink-2">
        <li>• Read-only: it cannot change, upload or delete anything.</li>
        <li>• Limited to your brands and your permissions.</li>
        <li>
          • You can disconnect it any time on{" "}
          <span className="text-ink">Account → API access</span>.
        </li>
      </ul>

      {error && (
        <p className="mt-3 rounded-md border border-neg/30 bg-neg/5 px-3 py-2 text-xs text-neg">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => void decide("deny")}
        >
          {busy === "deny" ? "Cancelling…" : "Deny"}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy !== null}
          onClick={() => void decide("allow")}
        >
          {busy === "allow" ? "Connecting…" : "Allow"}
        </Button>
      </div>

      <p className="mt-3 text-[11px] text-ink-3">
        You’ll be returned to <span className="font-mono">{host}</span>.
      </p>
    </div>
  );
}
