import React from 'react';
import Svg, { Path, Circle, Rect, Line, Polyline } from 'react-native-svg';
import { colors } from '../theme/theme';

export type IconName =
  | 'home' | 'search' | 'plus' | 'chat' | 'user' | 'back' | 'location'
  | 'check' | 'checkCircle' | 'star' | 'gear' | 'rotate' | 'phone'
  | 'car' | 'sofa' | 'shirt' | 'watch' | 'bag' | 'wallet' | 'banknote'
  | 'card' | 'diamond' | 'chevronRight' | 'sparkle' | 'camera' | 'close'
  | 'edit' | 'trophy' | 'globe' | 'trash' | 'grip'
  | 'building' | 'tv' | 'factory' | 'paw' | 'baby' | 'dumbbell' | 'briefcase' | 'wrench' | 'flag' | 'lock' | 'fingerprint'
  | 'image' | 'expand' | 'heart' | 'share' | 'wand' | 'eyeOff';

type Props = { name: IconName; size?: number; color?: string; strokeWidth?: number; filled?: boolean };

export default function Icon({ name, size = 22, color = colors.ink, strokeWidth = 1.6, filled = false }: Props) {
  const common = {
    fill: 'none' as const,
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' && (
        <>
          <Path d="M3 11.5 12 4l9 7.5" {...common} />
          <Path d="M5.5 10v9a1 1 0 0 0 1 1H9.5v-6h5v6H17.5a1 1 0 0 0 1-1v-9" {...common} />
        </>
      )}
      {name === 'search' && (
        <>
          <Circle cx="11" cy="11" r="6.5" {...common} />
          <Line x1="20" y1="20" x2="15.8" y2="15.8" {...common} />
        </>
      )}
      {name === 'plus' && (
        <>
          <Line x1="12" y1="5" x2="12" y2="19" {...common} />
          <Line x1="5" y1="12" x2="19" y2="12" {...common} />
        </>
      )}
      {name === 'chat' && (
        <Path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4.5 3.5V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" {...common} />
      )}
      {name === 'user' && (
        <>
          <Circle cx="12" cy="8.2" r="3.4" {...common} />
          <Path d="M4.8 20c1-3.6 4-5.4 7.2-5.4s6.2 1.8 7.2 5.4" {...common} />
        </>
      )}
      {name === 'back' && (
        <>
          <Line x1="19" y1="12" x2="6" y2="12" {...common} />
          <Polyline points="11.5,6 5,12 11.5,18" {...common} />
        </>
      )}
      {name === 'location' && (
        <>
          <Path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" {...common} />
          <Circle cx="12" cy="9.5" r="2.2" {...common} />
        </>
      )}
      {(name === 'check') && (
        <Polyline points="5,12.5 10,17.5 19,7" {...common} />
      )}
      {name === 'checkCircle' && (
        <>
          <Circle cx="12" cy="12" r="8.5" {...common} />
          <Polyline points="8,12.3 11,15.3 16,9.3" {...common} />
        </>
      )}
      {name === 'star' && (
        <Path d="M12 4.2 14.5 9.6 20.5 10.4 16.1 14.4 17.3 20.3 12 17.3 6.7 20.3 7.9 14.4 3.5 10.4 9.5 9.6 Z" {...common} />
      )}
      {name === 'gear' && (
        <>
          <Circle cx="12" cy="12" r="3" {...common} />
          <Path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7 16 16M8 8 6.3 6.3" {...common} />
        </>
      )}
      {name === 'rotate' && (
        <>
          <Path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" {...common} />
          <Polyline points="20,4.5 20,8.5 16,8.5" {...common} />
          <Path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" {...common} />
          <Polyline points="4,19.5 4,15.5 8,15.5" {...common} />
        </>
      )}
      {name === 'phone' && (
        <Rect x="7.2" y="2.5" width="9.6" height="19" rx="1.6" {...common} />
      )}
      {name === 'car' && (
        <>
          <Path d="M3.5 15.5 5 9.8a2 2 0 0 1 1.9-1.5h10.2A2 2 0 0 1 19 9.8l1.5 5.7" {...common} />
          <Path d="M3.2 15.5h17.6v3a1 1 0 0 1-1 1h-1.4a1 1 0 0 1-1-1v-1H6.6v1a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1v-3Z" {...common} />
          <Circle cx="7.3" cy="15.6" r="1.3" {...common} />
          <Circle cx="16.7" cy="15.6" r="1.3" {...common} />
        </>
      )}
      {name === 'sofa' && (
        <>
          <Path d="M5 12V8.5a1.5 1.5 0 0 1 3 0V11" {...common} />
          <Path d="M16 11V8.5a1.5 1.5 0 0 1 3 0V12" {...common} />
          <Path d="M4 12h16v4.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V12Z" {...common} />
          <Line x1="5" y1="17.5" x2="5" y2="20" {...common} />
          <Line x1="19" y1="17.5" x2="19" y2="20" {...common} />
        </>
      )}
      {name === 'shirt' && (
        <Path d="M8.5 3.5 12 5.5l3.5-2 4 3-2.5 3-1.5-1v11h-7v-11l-1.5 1-2.5-3 4-3Z" {...common} />
      )}
      {name === 'watch' && (
        <>
          <Circle cx="12" cy="12" r="5.2" {...common} />
          <Path d="M9.5 3.5h5l-.5 4h-4l-.5-4ZM9.5 20.5h5l-.5-4h-4l-.5 4Z" {...common} />
        </>
      )}
      {name === 'bag' && (
        <>
          <Path d="M7 8V6a5 5 0 0 1 10 0v2" {...common} />
          <Rect x="4" y="8" width="16" height="12.5" rx="1.6" {...common} />
        </>
      )}
      {name === 'wallet' && (
        <>
          <Rect x="3.2" y="6.5" width="17.6" height="12" rx="1.8" {...common} />
          <Path d="M15.5 12.5h3.3" {...common} />
        </>
      )}
      {name === 'banknote' && (
        <>
          <Rect x="2.8" y="6.8" width="18.4" height="10.4" rx="1.6" {...common} />
          <Circle cx="12" cy="12" r="2.4" {...common} />
        </>
      )}
      {name === 'card' && (
        <>
          <Rect x="2.8" y="5.8" width="18.4" height="12.4" rx="1.8" {...common} />
          <Line x1="2.8" y1="9.6" x2="21.2" y2="9.6" {...common} />
        </>
      )}
      {name === 'diamond' && (
        <Path d="M7 4h10l4 6-9 10L2 10Z" {...common} />
      )}
      {name === 'chevronRight' && (
        <Polyline points="9,5 16,12 9,19" {...common} />
      )}
      {name === 'sparkle' && (
        <Path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9 Z" {...common} />
      )}
      {/* Magic wand: a diagonal shaft with a four-point sparkle at the tip
          and two smaller ones trailing it. Reads as "do this for me",
          which is what the Magic Listing entry point needs it to say --
          the existing lone `sparkle` reads as decoration, and a gear or
          wrench would read as settings. */}
      {name === 'wand' && (
        <>
          <Path d="M4.5 19.5 13.5 10.5" {...common} />
          <Path d="M17.5 3 18.5 6 21.5 7 18.5 8 17.5 11 16.5 8 13.5 7 16.5 6 Z" {...common} />
          <Path d="M8.5 3.5 9 5 10.5 5.5 9 6 8.5 7.5 8 6 6.5 5.5 8 5 Z" {...common} />
          <Path d="M19.5 14 19.9 15.1 21 15.5 19.9 15.9 19.5 17 19.1 15.9 18 15.5 19.1 15.1 Z" {...common} />
        </>
      )}
      {name === 'camera' && (
        <>
          <Path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1-2h6l1 2h2.5A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18Z" {...common} />
          <Circle cx="12" cy="12.5" r="3.4" {...common} />
        </>
      )}
      {name === 'image' && (
        <>
          <Rect x="3.5" y="4.5" width="17" height="15" rx="1.6" {...common} />
          <Circle cx="8.3" cy="9.3" r="1.6" {...common} />
          <Path d="M5 17.5 9.8 12l3 3 2.4-2.6L19.5 17" {...common} />
        </>
      )}
      {name === 'heart' && (
        // Phase 4 item 17 -- favorites. `filled` is the only icon in this
        // set that ever fills: an empty outline heart means "not saved",
        // a filled one means "saved", same convention as every other app
        // that has this button.
        <Path
          d="M12 20.2 4.9 13.4a5 5 0 0 1 7.1-7 5 5 0 0 1 7.1 7Z"
          {...common}
          fill={filled ? color : 'none'}
        />
      )}
      {name === 'expand' && (
        <>
          <Path d="M9 4.5H5.5a1 1 0 0 0-1 1V9" {...common} />
          <Path d="M15 4.5h3.5a1 1 0 0 1 1 1V9" {...common} />
          <Path d="M9 19.5H5.5a1 1 0 0 1-1-1V15" {...common} />
          <Path d="M15 19.5h3.5a1 1 0 0 0 1-1V15" {...common} />
        </>
      )}
      {name === 'close' && (
        <>
          <Line x1="6" y1="6" x2="18" y2="18" {...common} />
          <Line x1="18" y1="6" x2="6" y2="18" {...common} />
        </>
      )}
      {name === 'edit' && (
        <Path d="M14.5 4.5 19 9 8.5 19.5 4 20.5 5 16 15.5 5.5Z" {...common} />
      )}
      {name === 'trophy' && (
        <>
          <Path d="M7 4.5h10v5.5a5 5 0 0 1-10 0Z" {...common} />
          <Path d="M7 6H4.5a2 2 0 0 0 0 4H7M17 6h2.5a2 2 0 0 1 0 4H17" {...common} />
          <Line x1="12" y1="15.5" x2="12" y2="18.5" {...common} />
          <Line x1="8.5" y1="20.5" x2="15.5" y2="20.5" {...common} />
        </>
      )}
      {name === 'globe' && (
        <>
          <Circle cx="12" cy="12" r="8.5" {...common} />
          <Line x1="3.5" y1="12" x2="20.5" y2="12" {...common} />
          <Path d="M12 3.5c2.8 2.6 2.8 14.4 0 17M12 3.5c-2.8 2.6-2.8 14.4 0 17" {...common} />
        </>
      )}
      {name === 'grip' && (
        <>
          <Circle cx="9" cy="6.5" r="1.1" fill={color} stroke="none" />
          <Circle cx="9" cy="12" r="1.1" fill={color} stroke="none" />
          <Circle cx="9" cy="17.5" r="1.1" fill={color} stroke="none" />
          <Circle cx="15" cy="6.5" r="1.1" fill={color} stroke="none" />
          <Circle cx="15" cy="12" r="1.1" fill={color} stroke="none" />
          <Circle cx="15" cy="17.5" r="1.1" fill={color} stroke="none" />
        </>
      )}
      {name === 'trash' && (
        <>
          <Path d="M5 7h14M9.5 7V5.2c0-.7.6-1.2 1.2-1.2h2.6c.7 0 1.2.6 1.2 1.2V7M6.5 7l.8 12c.05.9.8 1.5 1.6 1.5h6.2c.85 0 1.55-.65 1.6-1.5l.8-12" {...common} />
          <Line x1="10" y1="10.5" x2="10" y2="17" {...common} />
          <Line x1="14" y1="10.5" x2="14" y2="17" {...common} />
        </>
      )}
      {name === 'building' && (
        <>
          <Rect x="5.5" y="3" width="9" height="18" rx="1" {...common} />
          <Path d="M14.5 9.5H18a1 1 0 0 1 1 1V21h-4.5" {...common} />
          <Line x1="8" y1="6.5" x2="8" y2="6.5" {...common} />
          <Line x1="11.5" y1="6.5" x2="11.5" y2="6.5" {...common} />
          <Line x1="8" y1="10" x2="8" y2="10" {...common} />
          <Line x1="11.5" y1="10" x2="11.5" y2="10" {...common} />
          <Line x1="8" y1="13.5" x2="8" y2="13.5" {...common} />
          <Line x1="11.5" y1="13.5" x2="11.5" y2="13.5" {...common} />
          <Rect x="8.2" y="17" width="2.6" height="4" {...common} />
        </>
      )}
      {name === 'tv' && (
        <>
          <Rect x="3" y="5.5" width="18" height="12" rx="1.4" {...common} />
          <Line x1="8" y1="20.5" x2="16" y2="20.5" {...common} />
          <Line x1="12" y1="17.5" x2="12" y2="20.5" {...common} />
        </>
      )}
      {name === 'factory' && (
        <>
          <Path d="M3.5 20.5V11l5 3.2V11l5 3.2V9.5l5 3.2v7.8Z" {...common} />
          <Line x1="3.5" y1="20.5" x2="20.5" y2="20.5" {...common} />
          <Path d="M16.5 9.5V5.5h2v2.6" {...common} />
        </>
      )}
      {name === 'paw' && (
        <>
          <Circle cx="12" cy="15" r="3.4" {...common} />
          <Circle cx="6" cy="10.5" r="1.7" {...common} />
          <Circle cx="10" cy="7" r="1.7" {...common} />
          <Circle cx="14" cy="7" r="1.7" {...common} />
          <Circle cx="18" cy="10.5" r="1.7" {...common} />
        </>
      )}
      {name === 'baby' && (
        <>
          <Circle cx="12" cy="9" r="5" {...common} />
          <Path d="M9 8.5c0 1.3.8 2.2 1.5 1M15 8.5c0 1.3-.8 2.2-1.5 1" {...common} />
          <Path d="M9.7 11.3c.7.6 1.6.9 2.3.9s1.6-.3 2.3-.9" {...common} />
          <Path d="M8 4.5C6.8 5.4 6.5 6.5 6.5 7M16 4.5c1.2.9 1.5 2 1.5 2.5" {...common} />
          <Path d="M8 19.5c1-2.2 2.3-3 4-3s3 .8 4 3" {...common} />
        </>
      )}
      {name === 'dumbbell' && (
        <>
          <Line x1="6.5" y1="12" x2="17.5" y2="12" {...common} />
          <Rect x="3" y="9.5" width="2.6" height="5" rx="0.8" {...common} />
          <Rect x="18.4" y="9.5" width="2.6" height="5" rx="0.8" {...common} />
          <Rect x="5.6" y="8" width="1.8" height="8" rx="0.6" {...common} />
          <Rect x="16.6" y="8" width="1.8" height="8" rx="0.6" {...common} />
        </>
      )}
      {name === 'briefcase' && (
        <>
          <Rect x="3" y="7.5" width="18" height="11.5" rx="1.6" {...common} />
          <Path d="M8.5 7.5V5.8c0-.7.6-1.3 1.3-1.3h4.4c.7 0 1.3.6 1.3 1.3V7.5" {...common} />
          <Line x1="3" y1="12.5" x2="21" y2="12.5" {...common} />
        </>
      )}
      {name === 'wrench' && (
        <Path d="M14.7 6.3a3.7 3.7 0 0 0-4.9 4.4L4 16.5l2.5 2.5 5.8-5.8a3.7 3.7 0 0 0 4.4-4.9l-2.6 2.6-2-2Z" {...common} />
      )}
      {name === 'flag' && (
        <>
          <Line x1="5.5" y1="3.5" x2="5.5" y2="20.5" {...common} />
          <Path d="M5.5 4.5h10.8c1 0 1.4 1 .7 1.7l-2.9 2.8 2.9 2.8c.7.7.3 1.7-.7 1.7H5.5" {...common} />
        </>
      )}
      {name === 'lock' && (
        <>
          <Rect x="5" y="10.5" width="14" height="9.5" rx="1.8" {...common} />
          <Path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" {...common} />
          <Circle cx="12" cy="15" r="1.4" {...common} />
        </>
      )}
      {name === 'share' && (
        // Public seller profile page -- "Share profile". The classic
        // three-node share glyph (two endpoints + a relay node), not a
        // native OS share-sheet icon, since this needs to render
        // identically everywhere the app runs (react-native-svg on web),
        // not lean on a platform icon font.
        <>
          <Circle cx="18" cy="5" r="2.5" {...common} />
          <Circle cx="6" cy="12" r="2.5" {...common} />
          <Circle cx="18" cy="19" r="2.5" {...common} />
          <Line x1="8.2" y1="10.6" x2="15.8" y2="6.4" {...common} />
          <Line x1="8.2" y1="13.4" x2="15.8" y2="17.6" {...common} />
        </>
      )}
      {/* Eye with a diagonal strike -- My Listings' "Hide Listing" action.
          Reads as "hidden from view", the same convention every app uses
          for a password-visibility or hide toggle. */}
      {name === 'eyeOff' && (
        <>
          <Path d="M3 12s3.6-6.5 9-6.5S21 12 21 12s-3.6 6.5-9 6.5S3 12 3 12Z" {...common} />
          <Circle cx="12" cy="12" r="2.6" {...common} />
          <Line x1="4" y1="4" x2="20" y2="20" {...common} />
        </>
      )}
      {name === 'fingerprint' && (
        <>
          <Path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5v2.2" {...common} />
          <Path d="M3.5 14.2V12A8.5 8.5 0 0 1 12 3.5" {...common} />
          <Path d="M12 7.2a4.8 4.8 0 0 1 4.8 4.8v3.4a5.5 5.5 0 0 1-1 3.2" {...common} />
          <Path d="M7.2 12a4.8 4.8 0 0 1 4.8-4.8" {...common} />
          <Path d="M7.2 12v2.4a7.8 7.8 0 0 0 1.7 4.9" {...common} />
          <Path d="M12 9.8a2.2 2.2 0 0 1 2.2 2.2v2.6a8 8 0 0 1-.4 2.5" {...common} />
          <Path d="M9.8 12a2.2 2.2 0 0 1 2.2-2.2" {...common} />
          <Path d="M9.8 12v1.8c0 2 .5 3.5 1.4 4.8" {...common} />
        </>
      )}
    </Svg>
  );
}
