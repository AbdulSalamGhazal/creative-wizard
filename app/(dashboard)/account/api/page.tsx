import { requireAuth } from "@/lib/auth";
import { listApiTokens } from "@/lib/api-token";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ApiTokenManager } from "@/components/account/api-token-manager";
import { McpConnectPanel } from "@/components/account/mcp-connect-panel";
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
  const tokens = await listApiTokens(me.id);

  return (
    <PageShell width="admin">
      <PageHeader
        eyebrow="Account"
        title="API access"
        subtitle="Connect your own LLM (Claude, ChatGPT, …) to Wizard's read-only analytics over MCP. Create a personal access token below, then paste it into your client. A token acts as you — it can only see the brands and data you can."
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
