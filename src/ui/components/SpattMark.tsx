interface SpattMarkProps {
  size?: number;
}

/** The SPATT app mark: two rings of split bars divided by a barrier. Same drawing as favicon.svg. */
export default function SpattMark({ size = 28 }: SpattMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="spatt-mark-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1A8CFF" />
          <stop offset="1" stopColor="#0059B3" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill="url(#spatt-mark-gradient)" />
      <rect x="40" y="76" width="52" height="36" rx="8" fill="#fff" />
      <rect x="100" y="76" width="20" height="36" rx="8" fill="#fff" fillOpacity="0.55" />
      <rect x="136" y="76" width="80" height="36" rx="8" fill="#fff" />
      <rect x="40" y="144" width="28" height="36" rx="8" fill="#fff" fillOpacity="0.55" />
      <rect x="76" y="144" width="44" height="36" rx="8" fill="#fff" />
      <rect x="136" y="144" width="48" height="36" rx="8" fill="#fff" />
      <rect x="192" y="144" width="24" height="36" rx="8" fill="#fff" fillOpacity="0.55" />
      <rect x="124" y="56" width="8" height="144" rx="4" fill="#fff" />
    </svg>
  );
}
