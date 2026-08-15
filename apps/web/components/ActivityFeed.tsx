import clsx from "clsx";

export interface ActivityItem {
  id: string;
  type: "review" | "install" | "comment" | "error";
  message: string;
  ts: string;
  repo?: string;
}

const TYPE_STYLES = {
  review: "border-accent-violet bg-accent-violet/10 text-accent-violet",
  install: "border-status-green bg-status-green/10 text-status-green",
  comment: "border-text-muted bg-bg-hover text-text-muted",
  error: "border-status-red bg-status-red/10 text-status-red",
};

const TYPE_LABEL = {
  review: "rev",
  install: "ins",
  comment: "cmt",
  error: "err",
};

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3">
          <span
            className={clsx(
              "flex-shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded border uppercase font-semibold tracking-wider mt-0.5",
              TYPE_STYLES[item.type]
            )}
          >
            {TYPE_LABEL[item.type]}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-primary leading-snug">
              {item.message}
            </p>
            {item.repo && (
              <p className="text-xs text-text-muted font-mono mt-0.5">
                {item.repo}
              </p>
            )}
          </div>
          <span className="text-[10px] font-mono text-text-muted flex-shrink-0 mt-0.5">
            {item.ts}
          </span>
        </li>
      ))}
    </ul>
  );
}
