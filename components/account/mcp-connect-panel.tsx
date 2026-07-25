"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

/**
 * Copy-paste "How to connect" snippets for the read-only MCP server. Static —
 * the user substitutes their own token (created above). The URL is the deployed
 * streamable-HTTP endpoint.
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
          Replace <code className="font-mono">YOUR_TOKEN</code> with a token from
          above. The connection is read-only.
        </p>
      </div>
      <div className="space-y-4 p-4">
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
