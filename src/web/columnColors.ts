// Column colors carry *meaning* (status semantics), not just position.
//   backlog/inbox     → neutral gray  (idea pool, not started)
//   planned/todo      → blue          (scheduled)
//   in-progress/doing → amber         (actively being worked)
//   review            → purple        (in review)
//   approved          → teal          (approved, not yet shipped)
//   completed/done    → green         (done)
//   cancelled         → muted gray    (dropped)
export type ColColor = { c: string; bg: string };

const STATUS_COLORS: Record<string, ColColor> = {
  backlog: { c: "#8a8f98", bg: "#f0f1f2" },
  inbox: { c: "#8a8f98", bg: "#f0f1f2" },
  planned: { c: "#5b8def", bg: "#eaf1fd" },
  todo: { c: "#5b8def", bg: "#eaf1fd" },
  "in-progress": { c: "#e0a23c", bg: "#fbf2e0" },
  doing: { c: "#e0a23c", bg: "#fbf2e0" },
  review: { c: "#8b7fd6", bg: "#efedfb" },
  approved: { c: "#3fa697", bg: "#e4f3f0" },
  completed: { c: "#5fb37a", bg: "#e9f4ed" },
  complete: { c: "#5fb37a", bg: "#e9f4ed" },
  done: { c: "#5fb37a", bg: "#e9f4ed" },
  cancelled: { c: "#b0b0ac", bg: "#ededea" },
  canceled: { c: "#b0b0ac", bg: "#ededea" },
};

// Fallback palette for columns whose name we don't recognize (cycled by index).
const FALLBACK: ColColor[] = [
  { c: "#8b7fd6", bg: "#efedfb" },
  { c: "#e8845f", bg: "#fbeae3" },
  { c: "#e0a23c", bg: "#fbf2e0" },
  { c: "#d4be43", bg: "#faf6df" },
  { c: "#5fb37a", bg: "#e9f4ed" },
];

// Resolve a column's color by its id (semantic), falling back to the cycled
// palette keyed by position.
export function colColor(id: string, index = 0): ColColor {
  const key = String(id).toLowerCase();
  return STATUS_COLORS[key] || FALLBACK[((index % FALLBACK.length) + FALLBACK.length) % FALLBACK.length];
}
