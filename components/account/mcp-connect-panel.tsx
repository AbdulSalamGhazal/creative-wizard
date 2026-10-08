"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

/**
 * How to connect. TWO PATHS, and the order is the recommendation: sign-in
 * (OAuth 2.1 — paste the URL, approve the window, no secret to store) first,
 * then the personal-token snippets for clients that can't do a browser sign-in.
 *
 * The token path is NOT deprecated copy: `mcp-remote` and the desktop clients
 * register `http://localhost` callbacks, which this authorization server refuses
 * on purpose (https only), so a key is the right answer there — see lib/oauth.ts.
 */

// The Streamable-HTTP endpoint. mcp-handler serves the transport at
// `<basePath>/mcp`, so with the route under /api/mcp this is /api/mcp/mcp.
const MCP_URL = "https://creative.urjwan.com/api/mcp/mcp";

const SNIPPETS: { label: string; hint?: string; code: string }[] = [
  {
    label: "Claude Code (CLI)",
    code: `claude mcp add --transport http wizard ${MCP_URL} \\
  --header "Authorization: Bearer YOUR_TOKEN"`,
  },
  {
    label: "Claude Desktop / Cursor (config file)",
    hint: "Add under mcpServers in the client's JSON config (uses mcp-remote to attach the header).",
    code: `{
  "mcpServers": {
    "wizard": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${MCP_URL}",
        "--header", "Authorization:Bearer YOUR_TOKEN"
      ]
    }
  }
}`,
  },
  {
    label: "ChatGPT (developer-mode connector)",
    hint: "Add a connector → MCP server URL below → Authentication: custom header.",
    code: `URL:    ${MCP_URL}
Header: Authorization: Bearer YOUR_TOKEN`,
  },
  {
    label: "Generic (curl — list the tools)",
    code: `curl -s ${MCP_URL} \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  },
];

export function McpConnectPanel() {
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium text-ink">How to connect</h2>
        <p className="text-xs text-ink-3">
          Signing in is the simplest path; the token snippets are for clients
          that can&rsquo;t open a browser window. Either way, read-only.
        </p>
      </div>
      <div className="space-y-4 p-4">
        {/* The primary path. Deliberately not a code block — there is nothing
            to copy but the URL, and a snippet would make it look harder. */}
        <div className="space-y-1.5 rounded-md border border-brand/30 bg-brand/5 p-3">
          <div className="text-label text-ink-2">Claude (web, desktop or mobile) — recommended</div>
          <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-ink-2">
            <li>
              In Claude, add a custom connector with this URL:{" "}
              <code className="font-mono text-ink">{MCP_URL}</code>
            </li>
            <li>A Wizard window opens — sign in if you aren&rsquo;t already.</li>
            <li>
              Approve the connection. It appears under{" "}
              <span className="text-ink">Connected apps</span> above, and you can
              revoke it there any time.
            </li>
          </ol>
          <p className="text-[11px] text-ink-3">
            Nothing to paste or store: the connection is granted by signing in,
            and it reads only the brands and data you can see.
          </p>
        </div>
        {/* Renaming a tool's field is a breaking change for already-connected
            clients, so it's called out here as well as in every affected tool
            description. */}
        <p className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] text-ink-2">
          <span className="font-medium text-ink">Breaking change (Sep 2026):</span>{" "}
          the creative-labeling concept &ldquo;tag&rdquo; is now
          &ldquo;angle&rdquo;. In <code className="font-mono">list_creatives</code>,{" "}
          <code className="font-mono">get_creative</code>,{" "}
          <code className="font-mono">get_summary</code> and{" "}
          <code className="font-mono">get_overview</code>, the{" "}
          <code className="font-mono">tags</code> field and filter are now{" "}
          <code className="font-mono">angles</code>. Update any saved prompts —{" "}
          <code className="font-mono">tags</code> is no longer accepted.
        </p>
        <p className="text-[11px] text-ink-3">
          For the clients below, replace{" "}
          <code className="font-mono">YOUR_TOKEN</code> with a personal access
          token from above (they sign in with a header, not a browser window).
        </p>
        {SNIPPETS.map((s) => (
          <Snippet key={s.label} {...s} />
        ))}
      </div>
    </div>
  );
}

function Snippet({ label, hint, code }: { label: string; hint?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy manually.");
    }
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-label text-ink-2">{label}</div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
          aria-label={`Copy ${label} snippet`}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {hint && <p className="text-[11px] text-ink-3">{hint}</p>}
      <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-3 text-[11px] leading-relaxed text-ink-2">
        <code>{code}</code>
      </pre>
    </div>
  );
}
