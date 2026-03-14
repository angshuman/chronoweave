/* ChronoWeave -- Gap Detection & Cropped Mapping */

// Returns an array of {start, end} gap objects (in ms)
// where the gap between consecutive dates exceeds threshold.
export function detectGaps(dates, thresholdMs) {
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const curr = dates[i];
    if (curr - prev > thresholdMs) {
      gaps.push({ start: prev, end: curr });
    }
  }
  return gaps;
}

/**
 * Build a cropped time mapping:
 * Given a sorted list of event dates (ms), a gap threshold, and
 * a desired total visual width, returns a function
 *   mapTime(dateMs) -> x (pixels)
 * that compresses large gaps.
 *
 * Also returns:
 *   gaps: array of {start, end, xStart, xEnd, label} for rendering break indicators
 *   totalWidth: the actual rendered width in pixels
 */
export function buildCroppedMap(dates, opts = {}) {
  const {
    thresholdMs = 1000 * 60 * 60 * 24 * 365 * 5, // 5 years default
    gapWidthPx  = 40,   // how wide to render a compressed gap
    paddingPx   = 60,   // padding on each side
    pxPerMs     = null, // if null, auto-scale
    containerW  = 1200, // reference container width
  } = opts;

  if (!dates || dates.length === 0) {
    return { mapTime: () => paddingPx, gaps: [], totalWidth: containerW };
  }

  const sorted = [...new Set(dates)].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return {
      mapTime: () => containerW / 2,
      gaps: [],
      totalWidth: containerW,
    };
  }

  // Identify segments (runs of dates without large gaps)
  const segments = [];
  let segStart = sorted[0];
  let segDates = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > thresholdMs) {
      segments.push({ start: segStart, end: sorted[i - 1], dates: segDates });
      segStart = sorted[i];
      segDates = [sorted[i]];
    } else {
      segDates.push(sorted[i]);
    }
  }
  segments.push({ start: segStart, end: sorted[sorted.length - 1], dates: segDates });

  // Total real time span across segments (excluding gaps)
  const totalRealMs = segments.reduce((acc, s) => acc + (s.end - s.start || 1), 0);
  const numGaps = segments.length - 1;
  const availW = containerW - paddingPx * 2 - numGaps * gapWidthPx;
  const scale = availW > 0 ? availW / totalRealMs : 1;

  // Build segment pixel offsets
  let cursor = paddingPx;
  const segOffsets = [];
  for (let i = 0; i < segments.length; i++) {
    segOffsets.push(cursor);
    cursor += (segments[i].end - segments[i].start) * scale;
    if (i < segments.length - 1) cursor += gapWidthPx;
  }
  const totalWidth = cursor + paddingPx;

  // Build gap metadata
  const gapsMeta = [];
  for (let i = 0; i < numGaps; i++) {
    const xStart = segOffsets[i] + (segments[i].end - segments[i].start) * scale;
    const xEnd   = xStart + gapWidthPx;
    const ms     = segments[i + 1].start - segments[i].end;
    const years  = Math.round(ms / (1000 * 60 * 60 * 24 * 365.25));
    const label  = years >= 2 ? `~${years}y gap` : '~gap';
    gapsMeta.push({ start: segments[i].end, end: segments[i + 1].start, xStart, xEnd, label });
  }

  function mapTime(dateMs) {
    // Find which segment this date belongs to
    for (let i = 0; i < segments.length; i++) {
      if (dateMs <= segments[i].end + 1) {
        const rel = Math.max(0, dateMs - segments[i].start);
        return segOffsets[i] + rel * scale;
      }
    }
    // After last segment
    const last = segments[segments.length - 1];
    return segOffsets[segments.length - 1] + (dateMs - last.start) * scale;
  }

  return { mapTime, gaps: gapsMeta, totalWidth };
}
