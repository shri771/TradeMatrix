import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
} from "react";

const StreamContext = createContext(null);

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/stream`;
}

/**
 * Opens ONE backend websocket for the whole app and routes inbound messages to
 * panes by paneId. This avoids opening a separate socket per chart.
 */
export function StreamProvider({ children }) {
  const wsRef = useRef(null);
  const handlersRef = useRef(new Map()); // paneId -> callback
  const pendingRef = useRef([]); // messages queued while socket not open
  const readyRef = useRef(false);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && readyRef.current && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      pendingRef.current.push(msg);
    }
  }, []);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let reconnectTimer = null;

    const connect = () => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        readyRef.current = true;
        retry = 0;
        // Flush queued subscriptions, then re-assert current ones after a reconnect.
        const queued = pendingRef.current;
        pendingRef.current = [];
        queued.forEach((m) => ws.send(JSON.stringify(m)));
      };

      ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data);
        const cb = handlersRef.current.get(String(data.paneId));
        if (cb) cb(data);
      };

      ws.onclose = () => {
        readyRef.current = false;
        if (closed) return;
        retry += 1;
        const delay = Math.min(1000 * 2 ** retry, 10000);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const subscribe = useCallback(
    (paneId, { source, symbol, interval }, onCandle) => {
      handlersRef.current.set(String(paneId), onCandle);
      send({ action: "subscribe", paneId, source, symbol, interval });
    },
    [send]
  );

  const unsubscribe = useCallback(
    (paneId) => {
      handlersRef.current.delete(String(paneId));
      send({ action: "unsubscribe", paneId });
    },
    [send]
  );

  return (
    <StreamContext.Provider value={{ subscribe, unsubscribe }}>
      {children}
    </StreamContext.Provider>
  );
}

export function useStream() {
  const ctx = useContext(StreamContext);
  if (!ctx) throw new Error("useStream must be used within StreamProvider");
  return ctx;
}
