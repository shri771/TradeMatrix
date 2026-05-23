import { useEffect, useRef, useState } from "react";
import { init, dispose } from "klinecharts";
import { CHART_STYLES } from "../lib/chartTheme";

/**
 * Wraps the KLineChart instance lifecycle. Returns a ref for the chart host div,
 * a ref to the chart instance, and a `ready` flag once the chart exists.
 * Resizes the chart when its container changes size (e.g. grid gutter drag).
 */
export function useChart() {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = init(host, { styles: CHART_STYLES });
    chartRef.current = chart;
    setReady(true);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(host);

    return () => {
      ro.disconnect();
      dispose(host);
      chartRef.current = null;
      setReady(false);
    };
  }, []);

  return { hostRef, chartRef, ready };
}
