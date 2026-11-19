import { useCallback, useEffect, useRef, useState } from "react";

export type SocketState = "connecting" | "open" | "closed";

/**
 * A JSON WebSocket that reconnects with backoff (1 s → 10 s) while `url` is set.
 * `onMessage` may change between renders; the latest one is always used.
 * Close codes 4401/4404 (bad token / unknown link) stop reconnecting.
 */
export function useWebSocket(
  url: string | null,
  onMessage: (msg: Record<string, unknown>) => void,
): { state: SocketState; send: (msg: unknown) => boolean; fatal: number | null } {
  const [state, setState] = useState<SocketState>("closed");
  const [fatal, setFatal] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    if (!url) {
      setState("closed");
      return;
    }
    let stopped = false;
    let retry = 0;
    let timer: number | undefined;
    let ping: number | undefined;
    setFatal(null);

    const connect = () => {
      setState("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setState("open");
        ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25_000);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg && typeof msg === "object") handler.current(msg as Record<string, unknown>);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = (e) => {
        window.clearInterval(ping);
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        setState("closed");
        if (e.code === 4401 || e.code === 4404) {
          setFatal(e.code);
          return;
        }
        const delay = Math.min(10_000, 1000 * 2 ** retry++);
        timer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(ping);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [url]);

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  return { state, send, fatal };
}
