import { encoderHeartbeat, warmupEncoder } from '@nomad/api-gen';
import { useEffect } from 'react';

const HEARTBEAT_MS = 60_000;

/** Wakes the encoding VM on mount and keeps it alive while the review is open (both best effort). */
export function useEncoderWarmup(jobId: string): void {
  useEffect(() => {
    void warmupEncoder(jobId);
    const id = setInterval(() => void encoderHeartbeat(jobId), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [jobId]);
}
