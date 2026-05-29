import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; icon?: ReactNode; title?: string; onClick?: () => void };

// Top-of-page breadcrumb. Every level except the last is a clickable link.
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        const iconOnly = !!c.icon && !c.label;
        const inner = (
          <>
            {c.icon && (
              <span className={iconOnly ? "crumb-icon crumb-icon-only" : "crumb-icon"}>{c.icon}</span>
            )}
            {c.label}
          </>
        );
        return (
          <span className="crumb" key={i}>
            {c.onClick ? (
              <button className="crumb-link" onClick={c.onClick} title={c.title}>
                {inner}
              </button>
            ) : (
              <span className="crumb-current" title={c.title} aria-current={last ? "page" : undefined}>
                {inner}
              </span>
            )}
            {!last && (
              <span className="crumb-sep">
                <ChevronRight size={14} aria-hidden />
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
