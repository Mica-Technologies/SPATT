/**
 * Demand at an intersection: saturation flow settings, lane groups, volume counts, and the
 * capacity analysis of a pattern against its count.
 */
import Box from '@mui/material/Box';
import { CheckboxInput, NumberInput } from '../fields/GridInputs';
import { fieldId } from '../fields/paths';
import { useWorkspace } from '../state/workspace';
import { Section } from './patterns/Section';
import type { TabProps } from './types';
import AnalysisSection from './volumes/AnalysisSection';
import CountsSection from './volumes/CountsSection';
import LaneGroupsSection from './volumes/LaneGroupsSection';

export default function VolumesTab({ intersection, intersectionIndex, issues }: TabProps) {
  const editIntersection = useWorkspace((s) => s.editIntersection);
  const lengthUnit = useWorkspace((s) => s.project?.units.length ?? 'ft');
  const basePath = ['intersections', intersectionIndex];
  const capacityPath = [...basePath, 'capacity'];

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <Section title="Saturation flow">
        <Box sx={{ p: 1.5, display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <Box component="label" htmlFor={fieldId([...capacityPath, 'baseSaturationFlow'])} sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
            Base flow
            <Box sx={{ width: 72 }}>
              <NumberInput
                path={[...capacityPath, 'baseSaturationFlow']}
                label="Base saturation flow"
                value={intersection.capacity.baseSaturationFlow}
                min={1}
                max={3000}
                integer
                onCommit={(v) => editIntersection('Base saturation flow', (i) => (i.capacity.baseSaturationFlow = v!))}
              />
            </Box>
            pc/h of green per lane
          </Box>
          <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}>
            <CheckboxInput
              path={[...capacityPath, 'centralBusinessDistrict']}
              label="Central business district"
              value={intersection.capacity.centralBusinessDistrict}
              onCommit={(v) => editIntersection(v ? 'Central business district' : 'Not a central business district', (i) => (i.capacity.centralBusinessDistrict = v))}
            />
            Central business district (area factor 0.90)
          </Box>
        </Box>
      </Section>
      <LaneGroupsSection intersection={intersection} basePath={basePath} issues={issues} lengthUnit={lengthUnit} />
      <CountsSection intersection={intersection} basePath={basePath} issues={issues} />
      <AnalysisSection intersection={intersection} basePath={basePath} issues={issues} />
    </Box>
  );
}
