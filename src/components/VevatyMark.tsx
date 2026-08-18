import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme/theme';

// The Vevaty mark: a price tag with the V and the eyelet punched clean
// through it. See BRANDING.md part 1, and scripts/brand/mark.svg, which is
// the same geometry and the source every generated PNG comes from -- if
// one changes, change the other.
//
// fillRule="evenodd" is load-bearing, not a detail. The V and the eyelet
// are real holes rather than white shapes, which is what lets the mark sit
// on any colour, photo or dark field with no second variant, and what lets
// it survive Android's monochrome themed-icon treatment (which discards
// colour entirely and re-tints the silhouette).
export default function VevatyMark({
  size = 32,
  color = colors.primary,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path
        fillRule="evenodd"
        fill={color}
        d="M30 8h20a6 6 0 0 1 6 6v20a6 6 0 0 1-1.76 4.24L36.24 56.24a6 6 0 0 1-8.48 0L7.76 36.24a6 6 0 0 1 0-8.48L25.76 9.76A6 6 0 0 1 30 8zM49.7 18.5a4.2 4.2 0 1 0-8.4 0 4.2 4.2 0 0 0 8.4 0zM23.6 25.4 32 35.6l8.4-10.2 4.7 4.5L32 45.6 18.9 29.9z"
      />
    </Svg>
  );
}
