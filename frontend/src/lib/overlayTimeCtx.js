// Shared per-pane "time context" for user-drawn overlays (trend line, long/short
// position, fibonacci).
//
// THE PROBLEM this solves
// -----------------------
// KLineChart positions an overlay point by mapping its `timestamp` to a bar via
// `binarySearchNearest`, which returns the NEAREST loaded bar CLAMPED to
// [0, len-1] — it never extrapolates. So when you switch timeframe, any anchor
// whose timestamp falls OUTSIDE the newly-loaded/revealed bar window snaps to the
// first (or last) bar:
//   • a trend line drawn on `1d` viewed on `15m` (whose window is far shorter)
//     collapses onto bar 0 → the line "drifts to the left".
//   • a long/short position's right-edge handle (often a time just past the last
//     bar, especially in replay) snaps onto the last bar, colliding with the
//     entry → the profit/loss zone falls back to the full chart width → it
//     "extends to infinity".
//
// THE FIX
// -------
// ChartPane publishes each pane's loaded window here — the first & last bar
// timestamps and the bar interval (ms). An overlay then re-projects each anchor's
// x from its TRUE timestamp: in-window anchors keep KLineChart's coordinate;
// out-of-window anchors are extrapolated linearly (bars * barSpace) to their real,
// possibly off-screen, position. The line/zone then sits where that time actually
// is (scroll left — endless-history loads the bars — and it locks exactly) instead
// of clamping to a visible edge.

const ctxByPane = new Map(); // paneId -> { firstTs, lastTs, msPerBar }

export function setPaneTimeCtx(paneId, ctx) {
  if (paneId != null && ctx && Number.isFinite(ctx.firstTs) && Number.isFinite(ctx.lastTs)) {
    ctxByPane.set(paneId, ctx);
  }
}

export function clearPaneTimeCtx(paneId) {
  if (paneId != null) ctxByPane.delete(paneId);
}

// KLineChart's binarySearchNearest — replicated EXACTLY so we know which bar index
// `snappedX` corresponds to. It maps a timestamp to the NEAREST loaded bar, clamped
// to [0, n-1]. Its quirk is what causes the bug we fix below: a coarse-timeframe
// anchor's timestamp (e.g. a daily bar stamped at 00:00, which lands in the
// overnight GAP between intraday sessions) rounds to whichever whole session-edge
// bar is marginally closer — so two anchors a day apart can snap to different sides
// and the drawing lands on the wrong candles after a timeframe switch.
function nearestBarIndex(times, t) {
  let left = 0, right = times.length - 1;
  while (left !== right) {
    const midIndex = (left + right) >> 1;
    const width = right - left;
    if (t === times[left]) return left;
    if (t === times[right]) return right;
    if (t === times[midIndex]) return midIndex;
    if (t > times[midIndex]) left = midIndex; else right = midIndex;
    if (width <= 2) break;
  }
  return left;
}

// The TRUE fractional bar index of a timestamp: whole bars before it, plus the
// fraction of the way it sits between its two flanking bars. On a gap-collapsed
// axis (every bar is one slot wide regardless of the real time gap) this is the
// only position that means "the same moment" on every timeframe. Outside the loaded
// window we extrapolate by the average ms-per-bar (gap-inclusive).
function fractionalBarIndex(times, t, msPerBar) {
  const n = times.length;
  if (t <= times[0]) return msPerBar ? -((times[0] - t) / msPerBar) : 0;
  if (t >= times[n - 1]) return (n - 1) + (msPerBar ? (t - times[n - 1]) / msPerBar : 0);
  // Largest i with times[i] <= t.
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1; }
  const span = times[lo + 1] - times[lo];
  return lo + (span > 0 ? (t - times[lo]) / span : 0);
}

// Re-project a point's x from its timestamp. `snappedX` is KLineChart's coordinate
// for the point (the pixel of the NEAREST bar). Because the axis is linear in bar
// index at `barPx` px per bar, the exact position is snappedX shifted by the gap
// between the point's TRUE fractional index and the nearest whole index KLineChart
// used. This keeps a drawing anchored to the same real time across timeframe
// switches (in-window: exact & gap-aware; out-of-window: extrapolated).
function projectX(ctx, timestamp, snappedX, barPx) {
  if (!ctx || !Number.isFinite(timestamp) || !Number.isFinite(snappedX) || !barPx) return snappedX;
  const { firstTs, lastTs, msPerBar, times } = ctx;
  if (times && times.length >= 2) {
    const nearIdx = nearestBarIndex(times, timestamp);
    const fracIdx = fractionalBarIndex(times, timestamp, msPerBar);
    return snappedX + (fracIdx - nearIdx) * barPx;
  }
  // Fallback (no per-bar times published yet): average-density edge extrapolation.
  if (!msPerBar) return snappedX;
  if (timestamp < firstTs) return snappedX - ((firstTs - timestamp) / msPerBar) * barPx;
  if (timestamp > lastTs) return snappedX + ((timestamp - lastTs) / msPerBar) * barPx;
  return snappedX;
}

/**
 * Give every anchor a real `timestamp`, back-filling any that are missing.
 *
 * WHY anchors go missing a timestamp
 * ----------------------------------
 * A drawing click that lands in the BLANK area to the right of the last loaded
 * bar (common for a support/resistance line drawn into the future, and the norm
 * in replay / with price centred so the right half is empty) has no bar to map
 * to. KLineChart's `_coordinateToPoint` therefore stores that anchor with
 * `timestamp: undefined`, holding it ONLY by `dataIndex`. A raw bar index is
 * meaningless on another timeframe: on a switch KLineChart's `updatePointPosition`
 * re-reads `newData[oldDataIndex]` and the anchor teleports to an unrelated
 * (usually far earlier) bar — the "drawing jumps to the left when I go to a lower
 * timeframe" bug. `correctOverlayX` can't rescue it because there's no timestamp
 * to project from.
 *
 * THE FIX
 * -------
 * At draw-end / drag-end we convert each timestamp-less anchor's `dataIndex` into a
 * real wall-clock time by extrapolating along this pane's linear bar axis
 * (`firstTs + dataIndex * msPerBar`, the SAME gap-inclusive cadence projectX uses,
 * so there is ZERO shift on the timeframe it was drawn on). Once the anchor carries
 * a finite timestamp, KLineChart leaves it alone (updatePointPosition only touches
 * timestamp-less points) and re-derives its bar every render from that time — so it
 * stays put across timeframe switches and replay.
 *
 * Returns a new `points` array when anything was filled, else null (caller skips
 * the overrideOverlay). Requires `overlay.extendData.paneId` and a published ctx.
 */
export function fillMissingAnchorTimes(overlay, paneId) {
  const ctx = paneId != null ? ctxByPane.get(paneId) : null;
  const pts = overlay?.points;
  if (!ctx || !Array.isArray(pts) || !pts.length) return null;
  const { firstTs, msPerBar } = ctx;
  if (!Number.isFinite(firstTs) || !msPerBar) return null;
  let changed = false;
  const out = pts.map((p) => {
    if (Number.isFinite(p?.timestamp) || !Number.isFinite(p?.dataIndex)) return p;
    changed = true;
    return { ...p, timestamp: Math.round(firstTs + p.dataIndex * msPerBar) };
  });
  return changed ? out : null;
}

/**
 * Return a copy of `coordinates` with each x re-projected from the matching
 * overlay point's timestamp (see projectX). Requires the overlay to carry
 * `extendData.paneId` (ChartPane sets this on every user-drawn overlay) so we can
 * find that pane's window. Falls back to the untouched coordinates when no
 * context is published yet — same behaviour as before the fix.
 */
export function correctOverlayX(overlay, coordinates, barSpace) {
  const paneId = overlay?.extendData?.paneId;
  const ctx = paneId != null ? ctxByPane.get(paneId) : null;
  if (!ctx) return coordinates;
  const pts = overlay.points || [];
  // KLineChart passes barSpace as an object {bar, halfBar, gapBar, halfGapBar};
  // `bar` is the full per-index slot width (px). Accept a raw number too.
  const barPx = typeof barSpace === "number" ? barSpace : barSpace?.bar;
  return coordinates.map((c, i) => ({ ...c, x: projectX(ctx, pts[i]?.timestamp, c.x, barPx) }));
}
