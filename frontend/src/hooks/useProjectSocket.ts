import { useEffect, useRef } from 'react';

/**
 * Connexion WebSocket au canal temps réel du projet, avec reconnexion automatique.
 * Appelle onEvent (debounced côté appelant) à chaque événement reçu.
 */
export function useProjectSocket(projectId: string, onEvent: () => void) {
  const callbackRef = useRef(onEvent);

  useEffect(() => {
    callbackRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!projectId) return;
    let closed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${window.location.host}/ws?projectId=${projectId}`);
      socket.onmessage = () => callbackRef.current();
      socket.onclose = () => {
        if (!closed) retryTimer = window.setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [projectId]);
}
