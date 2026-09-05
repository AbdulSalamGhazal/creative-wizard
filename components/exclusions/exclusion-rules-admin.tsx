"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Plus, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { int, isoDate } from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import type { ExclusionRuleKind } from "@/lib/exclusion-rules";
import {
  previewExclusionRule,
  previewExclusionRuleRemoval,
  createExclusionRule,
  toggleExclusionRule,
  deleteExclusionRule,
} from "@/app/actions/exclusion-rules";
import type {
  ExclusionRuleRow,
  RuleImpactPreview,
} from "@/db/queries/exclusion-rules";

const KIND_LABEL: Record<ExclusionRuleKind, string> = {
  campaign_objective: "Campaign objective",
  campaign: "Specific campaign",
  creative: "Specific creative",
};

interface PickerOption {
  id: string;
  name: string;
  hint?: string;
}

/** What the confirm dialog is about to do. */
type PendingAction =
  | { mode: "create"; preview: RuleImpactPreview }
  | { mode: "activate" | "deactivate" | "delete"; rule: ExclusionRuleRow; preview: RuleImpactPreview };

/**
 * Configuration → Exclusions. Account-global rules that exclude every matching
 * record from aggregates (materialized by the engine). Every mutation is
 * preview-then-confirm with an acknowledgement checkbox — no one-click sweeps.
 */
export function ExclusionRulesAdmin({
  rules,
  campaigns,
  creatives,
}: {
  rules: ExclusionRuleRow[];
  campaigns: PickerOption[];
  creatives: PickerOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useNavTransition();

  // ── Add-rule form state ────────────────────────────────────────────────────
  const [kind, setKind] = useState<ExclusionRuleKind>("campaign_objective");
  const [objective, setObjective] = useState<string>("");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [creativeId, setCreativeId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [acked, setAcked] = useState(false);

  const target = {
    kind,
    objective: kind === "campaign_objective" ? objective || null : null,
    campaignId: kind === "campaign" ? campaignId : null,
    creativeId: kind === "creative" ? creativeId : null,
  };
  const targetChosen =
    (kind === "campaign_objective" && !!objective) ||
    (kind === "campaign" && !!campaignId) ||
    (kind === "creative" && !!creativeId);

  const resetForm = () => {
    setObjective("");
    setCampaignId(null);
    setCreativeId(null);
    setNote("");
  };

  const openDialog = (action: PendingAction) => {
    setAcked(false);
    setPending(action);
  };

  const previewCreate = () => {
    startTransition(async () => {
      const res = await previewExclusionRule(target);
      if (!res.ok || !res.preview) {
        toast.error(res.error ?? "Could not preview");
        return;
      }
      openDialog({ mode: "create", preview: res.preview });
    });
  };

  const previewToggleOrDelete = (
    rule: ExclusionRuleRow,
    mode: "activate" | "deactivate" | "delete",
  ) => {
    startTransition(async () => {
      const res =
        mode === "activate"
          ? await previewExclusionRule(rule)
          : await previewExclusionRuleRemoval(rule.id);
      if (!res.ok || !res.preview) {
        toast.error(res.error ?? "Could not preview");
        return;
      }
      openDialog({ mode, rule, preview: res.preview });
    });
  };

  const confirm = () => {
    if (!pending) return;
    startTransition(async () => {
      let res: { ok: boolean; error?: string; affected?: number };
      if (pending.mode === "create") {
        res = await createExclusionRule({ target, note: note.trim() || undefined });
      } else if (pending.mode === "delete") {
        res = await deleteExclusionRule(pending.rule.id);
      } else {
        res = await toggleExclusionRule({
          id: pending.rule.id,
          active: pending.mode === "activate",
        });
      }
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong");
        return;
      }
      const n = res.affected ?? 0;
      toast.success(
        pending.mode === "create" || pending.mode === "activate"
          ? `Rule applied — ${int(n)} record${n === 1 ? "" : "s"} excluded`
          : `${int(n)} record${n === 1 ? "" : "s"} back in totals`,
      );
      if (pending.mode === "create") resetForm();
      setPending(null);
      router.refresh();
    });
  };

  return (
    <div className="max-w-3xl space-y-4">
      {/* Add-rule card */}
      <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
        <div className="text-sm font-medium text-ink">Add a rule</div>
        <p className="text-xs text-ink-3">
          Everything the rule matches is excluded from aggregates everywhere,
          for everyone — now and for future uploads. Records people excluded
          manually are never touched.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr]">
          <div className="space-y-1.5">
            <Label>Rule type</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as ExclusionRuleKind);
                resetForm();
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABEL) as ExclusionRuleKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Target</Label>
            {kind === "campaign_objective" ? (
              <Select value={objective} onValueChange={setObjective}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick an objective…" />
                </SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_OBJECTIVES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <TargetPicker
                options={kind === "campaign" ? campaigns : creatives}
                value={kind === "campaign" ? campaignId : creativeId}
                onChange={kind === "campaign" ? setCampaignId : setCreativeId}
                placeholder={
                  kind === "campaign" ? "Search campaigns…" : "Search creatives…"
                }
              />
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rule-note">Note (optional)</Label>
          <Input
            id="rule-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this is excluded, for the next person"
            maxLength={200}
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={previewCreate}
          disabled={!targetChosen || isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          Preview &amp; create
        </Button>
      </div>

      {/* Rules list */}
      {rules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-2">
            <ShieldOff className="h-5 w-5 text-ink-2" />
          </div>
          <p className="mt-4 text-sm text-ink-2">No exclusion rules yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-ink-3">
            A rule keeps everything matching a campaign objective, a campaign,
            or a creative out of every aggregate — including future uploads —
            until you deactivate it.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line bg-surface">
          {rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-label text-ink-3">{KIND_LABEL[r.kind]}</span>
                  <span className={cn("truncate text-sm", r.active ? "text-ink" : "text-ink-3")}>
                    {r.kind === "campaign_objective" ? r.objective : (r.targetLabel ?? "—")}
                  </span>
                  {!r.active && (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                      inactive
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {r.active
                    ? `${int(r.excludedCount)} record${r.excludedCount === 1 ? "" : "s"} excluded`
                    : "not applied"}
                  {r.note ? ` · “${r.note}”` : ""}
                  {r.createdByName ? ` · ${r.createdByName}` : ""} ·{" "}
                  <span className="num">{isoDate(r.createdAt)}</span>
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={isPending}
                onClick={() =>
                  previewToggleOrDelete(r, r.active ? "deactivate" : "activate")
                }
              >
                {r.active ? "Deactivate" : "Activate"}
              </Button>
              <button
                type="button"
                onClick={() => previewToggleOrDelete(r, "delete")}
                disabled={isPending}
                className="text-ink-3 hover:text-neg"
                aria-label="Delete rule"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-3">
        Rules are account-global: pausing or deleting one changes the numbers
        for everyone. A record excluded by a rule can only be restored through
        the rule — the per-record Re-include stays disabled for it.
      </p>

      {/* Preview-then-confirm dialog (shared by all four mutations) */}
      <Dialog open={pending !== null} onOpenChange={(o) => !isPending && !o && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {pending.mode === "create" && "Create exclusion rule"}
                  {pending.mode === "activate" && "Activate rule"}
                  {pending.mode === "deactivate" && "Deactivate rule"}
                  {pending.mode === "delete" && "Delete rule"}
                </DialogTitle>
                <DialogDescription>
                  {pending.mode === "create" || pending.mode === "activate" ? (
                    <>
                      This will exclude{" "}
                      <b>{int(pending.preview.records)} records</b> across{" "}
                      {int(pending.preview.campaigns)} campaign
                      {pending.preview.campaigns === 1 ? "" : "s"} /{" "}
                      {int(pending.preview.creatives)} creative
                      {pending.preview.creatives === 1 ? "" : "s"}
                      {pending.preview.from && pending.preview.to && (
                        <>
                          {" "}
                          (<span className="num">{pending.preview.from}</span> →{" "}
                          <span className="num">{pending.preview.to}</span>)
                        </>
                      )}{" "}
                      from every aggregate, for everyone — and future uploads
                      that match will arrive excluded. Manually-excluded records
                      are not touched.
                    </>
                  ) : (
                    <>
                      This releases <b>{int(pending.preview.records)} records</b>{" "}
                      from this rule. Rows another active rule also covers stay
                      excluded (re-stamped by that rule); the rest return to
                      every aggregate, for everyone.
                      {pending.mode === "delete" &&
                        " The rule itself is removed — future uploads won't be stamped."}{" "}
                      Manual exclusions stay excluded.
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              <label className="flex items-start gap-2 text-xs text-ink-2">
                <Checkbox
                  checked={acked}
                  onCheckedChange={(v) => setAcked(v === true)}
                  className="mt-0.5"
                />
                I understand this changes the numbers for every user of this
                brand.
              </label>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPending(null)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant={pending.mode === "delete" ? "destructive" : "default"}
                  onClick={confirm}
                  disabled={!acked || isPending}
                >
                  {pending.mode === "create" && "Create rule"}
                  {pending.mode === "activate" && "Activate"}
                  {pending.mode === "deactivate" && "Deactivate"}
                  {pending.mode === "delete" && "Delete rule"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Searchable single-select over campaigns/creatives (cleanup-tool pattern). */
function TargetPicker({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: PickerOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 text-sm hover:bg-surface-2"
        >
          <span className={cn("truncate", selected ? "text-ink" : "text-ink-3")}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <Command
          filter={(v, search) => (v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder={placeholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>Nothing found.</CommandEmpty>
            {options.map((o) => (
              <CommandItem
                key={o.id}
                value={`${o.name} ${o.hint ?? ""}`}
                onSelect={() => {
                  onChange(o.id === value ? null : o.id);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-brand",
                    o.id === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate text-xs">{o.name}</span>
                {o.hint && (
                  <span className="ml-auto truncate text-[11px] text-ink-3">{o.hint}</span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
