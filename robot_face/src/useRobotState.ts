import { useState, useEffect } from 'react';

export type RobotStateKind = 'idle' | 'speaking' | 'listening' | 'thinking' | 'done';

export interface RobotStateData {
  state: RobotStateKind;
  text: string;
  sentence_id: string | null;
  result?: string;
}

const POLL_MS = 400;

export function useRobotState(): RobotStateData {
  const [data, setData] = useState<RobotStateData>({
    state: 'idle',
    text: '',
    sentence_id: null,
  });

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/robot/state');
        if (!cancelled && res.ok) {
          const json = (await res.json()) as RobotStateData;
          setData(json);
        }
      } catch {
        // network error — keep last known state
      }
    };

    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return data;
}
