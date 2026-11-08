/**
 * A canvas of moving traffic over the intersection drawing. It reads the playback time from a ref
 * every animation frame and redraws only when that time, its size or the colour scheme changes,
 * so playing never re-renders React. Colours are theme tokens resolved when drawing.
 */
import { useEffect, useRef, type RefObject } from 'react';
import Box from '@mui/material/Box';
import { useColorScheme, useTheme } from '@mui/material/styles';
import { trafficAt, type PreparedTraffic, type SceneBounds, type SceneView } from '../../engine';
import { LAMP } from './drawingStyle';
import { drawTraffic, type TrafficColors } from './drawTraffic';

export interface TrafficLayerProps {
  traffic: PreparedTraffic;
  view: SceneView;
  /** The drawing's extent (its viewBox), projected metres. */
  extent: SceneBounds;
  /** Playback time, seconds from the start of the run. */
  timeRef: RefObject<number>;
}

/** A CSS colour from a value that may be a `var(--token, fallback)` reference. */
function resolve(element: Element, value: string): string {
  const match = /^var\((--[^,)]+)(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!match) return value;
  const resolved = getComputedStyle(element).getPropertyValue(match[1]!).trim();
  return resolved || (match[2] ? resolve(element, match[2]) : 'currentColor');
}

export default function TrafficLayer({ traffic, view, extent, timeRef }: TrafficLayerProps) {
  const theme = useTheme();
  const { mode, systemMode } = useColorScheme();
  const canvas = useRef<HTMLCanvasElement>(null);
  const dirty = useRef(true);

  // Anything other than the time that changes the picture.
  useEffect(() => {
    dirty.current = true;
  }, [traffic, view, extent, mode, systemMode]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      dirty.current = true;
    });
    observer.observe(element);
    const palette = (theme.vars || theme).palette;
    let drawnAt = Number.NaN;
    let frame = requestAnimationFrame(function paint() {
      const t = timeRef.current;
      if (dirty.current || t !== drawnAt) {
        dirty.current = false;
        drawnAt = t;
        const ctx = element.getContext('2d');
        const rect = element.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        const width = Math.round(rect.width * ratio);
        const height = Math.round(rect.height * ratio);
        if (element.width !== width || element.height !== height) {
          element.width = width;
          element.height = height;
        }
        if (ctx) {
          const c = (value: string) => resolve(element, value);
          const colors: TrafficColors = {
            body: c(palette.primary.main),
            bodyShade: c(palette.primary.dark),
            bodyTop: c(palette.primary.light),
            outline: c(palette.grey[900]),
            brake: LAMP.red,
            pedestrian: c(palette.text.primary),
            pedestrianShade: c(palette.text.secondary),
            pedestrianOutline: c(palette.background.default),
            badge: c(palette.error.main),
            badgeText: c(palette.common.white),
          };
          drawTraffic(ctx, trafficAt(traffic, t), view, extent, { width: rect.width, height: rect.height, ratio }, colors);
        }
      }
      frame = requestAnimationFrame(paint);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [theme, traffic, view, extent, timeRef]);

  return <Box component="canvas" ref={canvas} aria-hidden="true" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
}
