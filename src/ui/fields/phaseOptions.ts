/** Short labels for phase fields, shared by the phase grid and the timing sheet. */
import type { Approach, MovementKind, VehicleRecall } from '../../model';

export const APPROACHES: { value: Approach | ''; label: string }[] = [
  { value: '', label: '—' },
  ...(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const).map((a) => ({ value: a, label: `${a}B` })),
];

export const MOVEMENTS: { value: MovementKind; label: string }[] = [
  { value: 'through', label: 'Thru' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Rt' },
  { value: 'pedestrian', label: 'Ped' },
  { value: 'other', label: 'Other' },
];

export const RECALLS: { value: VehicleRecall; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'minimum', label: 'Min' },
  { value: 'maximum', label: 'Max' },
  { value: 'soft', label: 'Soft' },
];

export const optionLabel = <T extends string>(options: readonly { value: T; label: string }[], value: T): string => options.find((o) => o.value === value)?.label ?? value;
