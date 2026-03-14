/* ChronoWeave -- Global State */

export const API = '';

// 10 distinct timeline colors
const COLORS = [
  '#6e7bf2','#f97316','#4ade80','#f43f5e','#facc15',
  '#22d3ee','#a78bfa','#fb7185','#34d399','#fbbf24',
];

export const S = {
  sessionId:        null,
  timelines:        [],
  visibleTimelines: [],
  selectedTimelines: new Set(),
  view:             'vertical',
  zoom:             1,
  minImportance:    1,
  gapCrop:          true,
  _colorIdx:        0,
  nextColor() {
    return COLORS[this._colorIdx++ % COLORS.length];
  },
};
