// Shared per-column accent palette — used by the home mini-board preview and
// the full kanban board so a column (and its cards) keep the same color.
export type ColColor = { c: string; bg: string };

export const COL_COLORS: ColColor[] = [
  { c: "#8b7fd6", bg: "#efedfb" }, // purple
  { c: "#e8845f", bg: "#fbeae3" }, // coral
  { c: "#e0a23c", bg: "#fbf2e0" }, // amber
  { c: "#d4be43", bg: "#faf6df" }, // yellow
  { c: "#5fb37a", bg: "#e9f4ed" }, // green
];

export const colColor = (i: number): ColColor => COL_COLORS[((i % COL_COLORS.length) + COL_COLORS.length) % COL_COLORS.length];
