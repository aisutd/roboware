import { useCallback, useEffect, useReducer, useRef } from 'react';
import { connectSessionStream, initialSessionState, sessionReducer } from '../services/sessionStream';

export function useSessionStream(sessionId) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const clientRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return undefined;
    dispatch({ type: 'reset' });
    const client = connectSessionStream(sessionId, dispatch);
    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [sessionId]);

  const send = useCallback((message) => clientRef.current?.send(message), []);
  return [state, send];
}
