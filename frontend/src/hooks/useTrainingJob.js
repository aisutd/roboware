import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

const POLL_MS = 400;

export function useTrainingJob(jobId, onFinished) {
  const [job, setJob] = useState(null);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    finishedRef.current = onFinished;
  });

  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    let timer = null;
    const poll = async () => {
      try {
        const next = await api.getTrainingJob(jobId);
        if (cancelled) return;
        setJob({ ...next, clientJobId: jobId });
        if (next.status === 'completed' || next.status === 'failed') {
          finishedRef.current?.(next);
          return;
        }
      } catch (err) {
        if (!cancelled) {
          // A transport error does not mean the backend training job failed.
          setJob((prev) => ({ ...(prev?.clientJobId === jobId ? prev : {}), clientJobId: jobId, pollingError: err.message }));
          timer = setTimeout(poll, 1500);
        }
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  return jobId && job?.clientJobId === jobId ? job : null;
}
