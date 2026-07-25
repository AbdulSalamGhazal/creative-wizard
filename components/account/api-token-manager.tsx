"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNavTransition } from "@/lib/nav-progress";
import {
  createApiTokenAction,
  revokeApiTokenAction,
} from "@/app/actions/api-token";

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function ApiTokenManager({ tokens }: { tokens: TokenRow[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TokenRow | null>(null);

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Personal access tokens</h2>
          <p className="text-xs text-ink-3">
            Bearer tokens for the MCP server. Shown once at creation — store yours
            securely.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New token
        </Button>
      </div>

      {tokens.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <KeyRound className="h-5 w-5 text-ink-3" />
          <p className="text-sm text-ink-2">No tokens yet.</p>
          <p className="text-xs text-ink-3">
            Create one to connect your LLM to Wizard.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-ink">{t.name}</div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-3">
                  <span>{t.prefix}…</span>
                  <span className="font-sans">· created {t.createdAt}</span>
                  <span className="font-sans">
                    · {t.lastUsedAt ? `last used ${t.lastUsedAt}` : "never used"}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-ink-3 hover:text-neg"
                onClick={() => setRevokeTarget(t)}
                aria-label={`Revoke ${t.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} />
      <RevokeTokenDialog
        token={revokeTarget}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
      />
    </div>
  );
}

function CreateTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useNavTransition();

  function reset() {
    setName("");
    setSecret(null);
    setError(null);
    setCopied(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createApiTokenAction({ name: name.trim() });
      if (!res.ok || !res.token) {
        setError(res.error ?? "Couldn't create token");
        return;
      }
      setSecret(res.token);
    });
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success("Token copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy manually.");
    }
  }

  function close() {
    onOpenChange(false);
    // Defer reset so the dialog's close animation doesn't flash the form.
    setTimeout(reset, 200);
    if (secret) router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (isPending) return;
        if (!o) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your token now</DialogTitle>
              <DialogDescription>
                This is the only time it&apos;s shown. Paste it into your MCP
                client, then close this dialog.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                {secret}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={copy}
                aria-label="Copy token"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-ink-2">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
              Treat it like a password — it can read all your brands&apos; data.
            </div>
            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>New API token</DialogTitle>
              <DialogDescription>
                Name it after where you&apos;ll use it (e.g. &ldquo;Claude
                Desktop&rdquo;) so you can tell your tokens apart.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-2">
              <Label htmlFor="token-name">Token name</Label>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Claude Desktop"
                maxLength={64}
                autoFocus
                required
              />
              {error && (
                <p className="rounded-md border border-neg/30 bg-neg/5 px-3 py-2 text-xs text-ink">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={close}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !name.trim()}>
                {isPending ? "Creating…" : "Create token"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeTokenDialog({
  token,
  onOpenChange,
}: {
  token: TokenRow | null;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useNavTransition();

  function revoke() {
    if (!token) return;
    startTransition(async () => {
      const res = await revokeApiTokenAction({ tokenId: token.id });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't revoke token");
        return;
      }
      toast.success(`Revoked ${token.name}`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={token !== null} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Revoke token</DialogTitle>
          <DialogDescription>
            Any client using <span className="font-medium text-ink">{token?.name}</span>{" "}
            ({token?.prefix}…) will stop working immediately. This can&apos;t be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={revoke}
            disabled={isPending}
          >
            {isPending ? "Revoking…" : "Revoke token"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
