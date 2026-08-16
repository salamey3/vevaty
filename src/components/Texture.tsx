import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, Pattern, Circle, Rect } from 'react-native-svg';
import { colors } from '../theme/theme';

// A very faint tiled dot texture painted on the screen's background layer.
// Screen content (in a ScrollView) scrolls *over* this fixed layer, which is
// what keeps the glass-blur cards on top of it looking properly "glassy" —
// same trick used in the web prototype (texture on a non-scrolling ancestor).
export default function Texture() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="grain" width="26" height="26" patternUnits="userSpaceOnUse">
          <Circle cx="3" cy="3" r="1" fill={colors.ink} opacity={0.05} />
          <Circle cx="16" cy="12" r="0.8" fill={colors.ink} opacity={0.04} />
          <Circle cx="9" cy="20" r="0.9" fill={colors.ink} opacity={0.045} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={colors.bg} />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#grain)" />
    </Svg>
  );
}
