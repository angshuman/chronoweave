/* ChronoWeave -- Global State & Constants */

export const API = ""; // relative -- works on localhost:8000 (Express) and Vercel

export const S = {
  sessions: [],
  activeId: null,
  timelines: [],
  selected: new Set(),
  view: "linear",
  zoom: 1.0,
  minImportance: 0,
  theme: "midnight",
};

export const COLORS = ["#6e7bf2","#f87171","#4ade80","#fb923c","#a78bfa","#22d3ee","#e8af34","#f472b6","#38bdf8","#a3e635"];
let colorIdx = 0;
export function nextColor() { return COLORS[colorIdx++ % COLORS.length]; }
export function resetColorIdx() { colorIdx = 0; }

export const ZOOM_STEPS = [0.15, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0];

export const GAP_BREAK_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 4l6 4-6 4"/><path d="M8 4l6 4-6 4"/></svg>';
