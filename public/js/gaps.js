/* ChronoWeave -- Gap Detection & Cropped Mapping */

/**
 * Detect gaps between events that should be compressed.
 * Scales the minimum gap with the total span of the timeline so
 * dense timelines (e.g. WW2, 12 years) don't get cluttered with
 * tiny 7-month breaks. Caps results to the top 3 largest gaps.
 */
export function detectGaps(parsedEvents) {
  if (parsedEvents.length < 2) return [];

  const gaps = [];
  for (let i = 0; i < parsedEvents.length - 1; i++) {
    const endTs = parsedEvents[i]._end || parsedEvents[i]._start;
    const nextStart = parsedEvents[i + 1]._start;
    const gapMs = nextStart - endTs;
    if (gapMs > 0) {
      gaps.push({ idx: i, gapMs, startTs: endTs, endTs: nextStart });
    }
  }

  if (gaps.length < 2) return [];

  const sorted = [...gaps].sort((a, b) => a.gapMs - b.gapMs);
  const median = sorted[Math.floor(sorted.length / 2)].gapMs;
  const threshold = median * 3;

  // Scale minimum gap with timeline span:
  //  < 20 years → min 2 years
  //  20-50 years → min 1 year
  //  50-200 years → min 6 months
  //  200+ years → min 6 months
  const totalSpanMs = parsedEvents[parsedEvents.length - 1]._start - parsedEvents[0]._start;
  const totalYears = totalSpanMs / (365.25 * 24 * 3600 * 1000);
  const YEAR_MS = 365.25 * 24 * 3600 * 1000;
  let minGap;
  if (totalYears < 20) minGap = 2 * YEAR_MS;
  else if (totalYears < 50) minGap = 1 * YEAR_MS;
  else minGap = 0.5 * YEAR_MS;

  const candidates = gaps
    .filter(g => g.gapMs > threshold && g.gapMs > minGap)
    .sort((a, b) => b.gapMs - a.gapMs)
    .slice(0, 3)   // cap at top 3 largest gaps
    .sort((a, b) => a.startTs - b.startTs)
    .map(g => {
      const years = g.gapMs / YEAR_MS;
      let label;
      if (years >= 1) {
        label = `${Math.round(years)}y`;
      } else {
        const months = Math.round(years * 12);
        label = `${months}mo`;
      }
      return { afterIdx: g.idx, startTs: g.startTs, endTs: g.endTs, gapMs: g.gapMs, label };
    });

  return candidates;
}

/**
 * Build a position mapping that compresses gaps into fixed-size breaks.
 * The break is visually indicated by a // mark on the axis.
 * Returns { posFunc(ts), totalPx, gapBreaks: [{pos, label}] }
 */
export function buildGapCroppedMapping(parsedEvents, gaps, pxPerMsNormal, startOffset) {
  if (!gaps.length) {
    const minTs = parsedEvents[0]._start;
    return {
      posFunc: ts => startOffset + (ts - minTs) * pxPerMsNormal,
      totalExtent: (parsedEvents[parsedEvents.length - 1]._end || parsedEvents[parsedEvents.length - 1]._start) - minTs,
      gapBreaks: [],
      effectivePxPerMs: pxPerMsNormal,
    };
  }

  const GAP_PX = 36; // compact space for break indicator
  const minTs = parsedEvents[0]._start;
  const maxTs = Math.max(...parsedEvents.map(e => e._end || e._start));

  const sortedGaps = [...gaps].sort((a, b) => a.startTs - b.startTs);

  const segments = [];
  let prevEnd = minTs;
  let accOffset = 0;

  sortedGaps.forEach(g => {
    const segSpan = g.startTs - prevEnd;
    if (segSpan > 0) {
      segments.push({ fromTs: prevEnd, toTs: g.startTs, pxStart: accOffset, pxSpan: segSpan * pxPerMsNormal });
      accOffset += segSpan * pxPerMsNormal;
    }
    segments.push({ isGap: true, pxStart: accOffset, label: g.label, fromTs: g.startTs, toTs: g.endTs });
    accOffset += GAP_PX;
    prevEnd = g.endTs;
  });

  const finalSpan = maxTs - prevEnd;
  if (finalSpan > 0) {
    segments.push({ fromTs: prevEnd, toTs: maxTs, pxStart: accOffset, pxSpan: finalSpan * pxPerMsNormal });
    accOffset += finalSpan * pxPerMsNormal;
  }

  const gapBreaks = segments.filter(s => s.isGap).map(s => ({
    pos: startOffset + s.pxStart + GAP_PX / 2,
    label: s.label,
  }));

  function posFunc(ts) {
    for (const seg of segments) {
      if (seg.isGap) {
        if (ts >= seg.fromTs && ts <= seg.toTs) {
          return startOffset + seg.pxStart + GAP_PX / 2;
        }
        continue;
      }
      if (ts >= seg.fromTs && ts <= seg.toTs) {
        const frac = (ts - seg.fromTs) / (seg.toTs - seg.fromTs || 1);
        return startOffset + seg.pxStart + frac * seg.pxSpan;
      }
    }
    const lastSeg = segments[segments.length - 1];
    if (lastSeg.isGap) return startOffset + lastSeg.pxStart + GAP_PX;
    return startOffset + lastSeg.pxStart + lastSeg.pxSpan;
  }

  return { posFunc, totalPx: accOffset, gapBreaks, effectivePxPerMs: pxPerMsNormal };
}
