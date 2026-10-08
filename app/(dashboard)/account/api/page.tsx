import { requireAuth } from "@/lib/auth";
import { listApiTokens } from "@/lib/api-token";
import { listOauthGrants } from "@/lib/oauth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ApiTokenManager } from "@/components/account/api-token-manager";
import { McpConnectPanel } from "@/components/account/mcp-connect-panel";
import { OauthGrants } from "@/components/account/oauth-grants";
import { isoDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "API access" };

/**
 * Self-serve API access — every user manages their OWN personal access tokens
 * for the read-only MCP server (connect Claude / ChatGPT to Wizard). A token
 * acts as its owner: it sees exactly the brands and data the web app would.
 */
export default async function ApiAccessPage() {
  const me = await requireAuth();
  // Two reads, deliberately serial — `lib/db.ts` is `max: 1`, so Promise.all
  // would buy nothing here.
  const tokens = await listApiTokens(me.id);
  const grants = await listOauthGrants(me.id);

  return (
    <PageShell width="admin">
      <PageHeader
        eyebrow="Account"
        title="API access"
        subtitle="Connect your own LLM (Claude, ChatGPT, …) to Wizard's read-only analytics over MCP. The simplest way is to add the MCP URL in Claude and sign in when the window opens — no key to paste. A personal access token is still there for clients that can't sign in. Either way the connection acts as you: it can only see the brands and data you can."
      />

      <OauthGrants
        grants={grants.map((g) => ({
          familyId: g.familyId,
          clientName: g.clientName,
          createdAt: isoDate(g.createdAt),
          lastUsedAt: g.lastUsedAt ? isoDate(g.lastUsedAt) : null,
        }))}
      />

      <ApiTokenManager
        tokens={tokens.map((t) => ({
          id: t.id,
          name: t.name,
          prefix: t.prefix,
          createdAt: isoDate(t.createdAt),
          lastUsedAt: t.lastUsedAt ? isoDate(t.lastUsedAt) : null,
        }))}
      />

      <McpConnectPanel />
    </PageShell>
  );
}
