import { LucideIcon } from "lucide-react";
import clsx from "clsx";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  trend?: { value: string; up: boolean } | null;
  accent?: boolean;
}

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  accent = false,
}: StatCardProps) {
  return (
    <div
      className={clsx(
        "bg-bg-panel border rounded-xl p-4 flex flex-col gap-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10",
        accent
          ? "border-accent-violet/30 bg-accent-violet-glow shadow-lg shadow-accent-violet/5"
          : "border-bg-border hover:border-bg-hover"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-text-muted uppercase tracking-wider">
          {label}
        </span>
        <div
          className={clsx(
            "w-7 h-7 rounded-lg flex items-center justify-center",
            accent ? "bg-accent-violet/20" : "bg-bg-hover"
          )}
        >
          <Icon
            size={13}
            className={accent ? "text-accent-violet" : "text-text-secondary"}
          />
        </div>
      </div>
      <div>
        <p
          className={clsx(
            "text-2xl font-mono font-semibold",
            accent ? "text-accent-violet" : "text-text-primary"
          )}
        >
          {value}
        </p>
        {sub && (
          <p className="text-xs text-text-muted font-mono mt-0.5">{sub}</p>
        )}
      </div>
      {trend && (
        <div
          className={clsx(
            "inline-flex items-center gap-1 text-xs font-mono",
            trend.up ? "text-status-green" : "text-status-red"
          )}
        >
          <span>{trend.up ? "↑" : "↓"}</span>
          <span>{trend.value} vs last week</span>
        </div>
      )}
    </div>
  );
}
