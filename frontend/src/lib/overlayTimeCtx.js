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

// Extrapolate a single point's x. `snappedX` is KLineChart's coordinate for the
// point (== bar 0's x when the timestamp is left of the window, == bar N-1's x
// when it's right of it, because of the nearest-bar clamp), so we only need to
// offset it by however many bars the timestamp lies beyond that edge.
//
// `msPerBar` is the AVERAGE real time each bar covers in the loaded window, NOT
// the nominal interval — markets have gaps (nights, weekends, holidays), so a 1h
// chart of an equity averages ~5h of wall-clock per bar. Using the nominal 1h
// here overcounted bars ~5x and dragged anchors far to the left ("drawn on 15–17,
// shown on 14–15"). The gap-inclusive average keeps the projection honest as long
// as the gap pattern outside the window resembles the pattern inside it.
function projectX(ctx, timestamp, snappedX, barPx) {
  if (!ctx || !Number.isFinite(timestamp) || !Number.isFinite(snappedX) || !barPx) return snappedX;
  const { firstTs, lastTs, msPerBar } = ctx;
  if (!msPerBar) return snappedX;
  if (timestamp < firstTs) return snappedX - ((firstTs - timestamp) / msPerBar) * barPx;
  if (timestamp > lastTs) return snappedX + ((timestamp - lastTs) / msPerBar) * barPx;
  return snappedX; // in-window: KLineChart's nearest-bar coordinate is accurate
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
