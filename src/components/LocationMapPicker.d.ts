import type { ComponentType } from 'react';
import type { LatLng } from '../lib/geo';

// Type-only companion for the LocationMapPicker.web.tsx /
// LocationMapPicker.native.tsx platform split. Metro resolves the bare
// `./LocationMapPicker` import to the right platform file automatically at
// bundle time (that's the whole point of the .web/.native suffix
// convention), but plain `tsc` has no platform context to pick between
// them -- without this file it can't resolve the bare import at all
// ("Cannot find module"). A sibling .d.ts is the standard fix: TypeScript
// resolves a bare specifier to a .d.ts file same as a .ts/.tsx file, no
// project-wide tsconfig changes needed (a global `moduleSuffixes` override
// was tried first and rejected -- it also changed how react-native-web's
// own internal modules resolve, which broke unrelated files' type-checking
// elsewhere in the app).
//
// Keep this in sync with both real implementations' prop types by hand --
// there's no way to have tsc derive it from either file automatically
// given the above.
declare const LocationMapPicker: ComponentType<{
  value: LatLng | null;
  onChange: (coords: LatLng) => void;
  hint?: string;
  pinLabel?: string;
  height?: number;
}>;

export default LocationMapPicker;
