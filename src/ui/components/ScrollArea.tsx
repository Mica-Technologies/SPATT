/**
 * A horizontally scrolling container that shows a fade and a chevron at each edge with more
 * content beyond it, so a wide grid that does not fit says so instead of silently clipping.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

interface ScrollAreaProps {
  children: ReactNode;
  /** Styles for the outer box (border, radius, width...). */
  sx?: SxProps<Theme>;
  /** Background the fades blend into (a palette path). */
  background?: 'paper' | 'default';
  /** On the outer box, e.g. for print styles. */
  className?: string;
}

const FADE = 36;

/** Width of a table's sticky first or last column, so the fade sits beside it rather than over it. */
function stickyWidth(cell: Element | null): number {
  return cell && getComputedStyle(cell).position === 'sticky' ? cell.getBoundingClientRect().width : 0;
}

export default function ScrollArea({ children, sx, background = 'paper', className }: ScrollAreaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false, stickyStart: 0, stickyEnd: 0 });
  const { stickyStart, stickyEnd } = edges;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const max = element.scrollWidth - element.clientWidth;
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft < max - 1;
      const stickyStart = Math.round(stickyWidth(element.querySelector('tr > :first-child')));
      const stickyEnd = Math.round(stickyWidth(element.querySelector('tr > :last-child')));
      setEdges((e) => (e.start === start && e.end === end && e.stickyStart === stickyStart && e.stickyEnd === stickyEnd ? e : { start, end, stickyStart, stickyEnd }));
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    // jsdom (unit tests) has no ResizeObserver.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    for (const child of Array.from(element.children)) observer?.observe(child);
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  const scrollBy = (direction: 1 | -1) => {
    const element = ref.current;
    if (element) element.scrollBy({ left: direction * Math.max(120, (element.clientWidth - stickyStart - stickyEnd) * 0.8), behavior: 'smooth' });
  };

  const fade = (side: 'start' | 'end') => (
    <Box
      aria-hidden
      sx={(theme) => {
        const bg = (theme.vars ?? theme).palette.background[background];
        return {
          position: 'absolute',
          top: 0,
          bottom: 0,
          [side === 'start' ? 'left' : 'right']: side === 'start' ? stickyStart : stickyEnd,
          width: FADE,
          zIndex: 3,
          pointerEvents: 'none',
          background: `linear-gradient(to ${side === 'start' ? 'right' : 'left'}, ${bg}, transparent)`,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: side === 'start' ? 'flex-start' : 'flex-end',
          pt: 0.75,
        };
      }}
    >
      <Box
        component="span"
        onClick={() => scrollBy(side === 'start' ? -1 : 1)}
        sx={{
          pointerEvents: 'auto',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          width: 22,
          height: 22,
          borderRadius: '50%',
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          color: 'text.secondary',
          boxShadow: 1,
          mx: 0.25,
          '&:hover': { color: 'text.primary' },
        }}
      >
        {side === 'start' ? <ChevronLeftRoundedIcon sx={{ fontSize: 18 }} /> : <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />}
      </Box>
    </Box>
  );

  return (
    <Box className={className} sx={[{ position: 'relative', overflow: 'hidden', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Box ref={ref} sx={{ overflowX: 'auto', minWidth: 0, position: 'relative' }}>
        {children}
      </Box>
      {edges.start ? fade('start') : null}
      {edges.end ? fade('end') : null}
    </Box>
  );
}
