/**
 * A cursor that plays round one cycle. The running position lives in a ref and advances every
 * animation frame; React state (and so a re-render) changes only when the whole tenth changes, the
 * resolution of every timing value. With reduced motion it steps once a second instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Tenths } from '../../model';

export interface CyclePlayer {
  /** Local cycle time, whole tenths, 0 ≤ time < cycle. */
  time: Tenths;
  setTime(time: Tenths): void;
  playing: boolean;
  setPlaying(playing: boolean): void;
  /** True when the user prefers reduced motion: playback steps per second and nothing flashes. */
  reducedMotion: boolean;
}

const wrap = (value: number, cycle: number) => ((value % cycle) + cycle) % cycle;

export function useCyclePlayer(cycle: Tenths, speed = 1): CyclePlayer {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', {
    noSsr: true,
  });
  const [time, setTimeState] = useState<Tenths>(0);
  const [playing, setPlaying] = useState(false);
  const cursor = useRef(0);

  const setTime = useCallback(
    (next: Tenths) => {
      const t = cycle > 0 ? wrap(Math.round(next), cycle) : 0;
      cursor.current = t;
      setTimeState(t);
    },
    [cycle],
  );

  // Keep the cursor inside a cycle that has been shortened.
  useEffect(() => {
    if (cycle > 0 && cursor.current >= cycle) setTime(cursor.current);
  }, [cycle, setTime]);

  useEffect(() => {
    if (!playing || cycle <= 0) return;
    if (reducedMotion) {
      const timer = setInterval(() => setTime(Math.floor(cursor.current / 10) * 10 + 10), 1000);
      return () => clearInterval(timer);
    }
    let last = performance.now();
    let frame = requestAnimationFrame(function advance(now) {
      cursor.current = wrap(cursor.current + ((now - last) / 100) * speed, cycle);
      last = now;
      const whole = Math.floor(cursor.current);
      setTimeState((shown) => (shown === whole ? shown : whole));
      frame = requestAnimationFrame(advance);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, reducedMotion, cycle, speed, setTime]);

  return { time, setTime, playing, setPlaying, reducedMotion };
}
