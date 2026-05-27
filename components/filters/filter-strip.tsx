import { CalendarDays, Layers, Package, Tag, Filter } from "lucide-react";

interface FilterChipProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
  active?: boolean;
}

function FilterChip({ icon: Icon, label, value, active }: FilterChipProps) {
  return (
    <button
      type="button"
      className={
        "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors " +
        (active
          ? "border-brand text-ink bg-[var(--brand-soft)]"
          : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink")
      }
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="text-ink-3">{label}</span>
      {value && <span className="text-ink">{value}</span>}
    </button>
  );
}

export function FilterStrip() {
  return (
    <div className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
      <div className="flex items-center gap-2 px-6 h-12 overflow-x-auto">
        <FilterChip
          icon={CalendarDays}
          label="Date"
          value="Last 30 days"
          active
        />
        <FilterChip icon={Package} label="Products" value="All" />
        <FilterChip icon={Layers} label="Platforms" value="All" />
        <FilterChip icon={Tag} label="Tags" value="Any" />
        <div className="ml-auto flex items-center gap-2 text-xs text-ink-3">
          <Filter className="w-3.5 h-3.5" />
          <span>Excluded records hidden</span>
        </div>
      </div>
    </div>
  );
}
