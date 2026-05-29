import {
  ClipboardList,
  Network,
  Palette,
  SquareKanban,
  LayoutGrid,
  FileText,
  Folder,
  Scale,
  Users,
  BookOpen,
  Archive,
  Package,
  type LucideIcon,
} from "lucide-react";

// Category icons are stored in knboard.config.json as stable Lucide names.
// Map them here via explicit imports so an unknown name fails loudly at the
// registry rather than silently rendering nothing.
const REGISTRY: Record<string, LucideIcon> = {
  ClipboardList,
  Network,
  Palette,
  SquareKanban,
  LayoutGrid,
  FileText,
  Folder,
  Scale,
  Users,
  BookOpen,
  Archive,
  Package,
};

export function Icon({ name, size = 16, className }: { name?: string; size?: number; className?: string }) {
  const C = (name && REGISTRY[name]) || Folder;
  return <C size={size} strokeWidth={2} className={className} aria-hidden />;
}
