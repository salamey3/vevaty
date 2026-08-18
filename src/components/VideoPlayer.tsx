import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import Pressy from './Pressy';
import { colors, radius, type } from '../theme/theme';
import { videoPlaybackUrl, videoThumbnailUrl } from '../lib/bunnyVideo';

type Props = {
  guid: string;
  // The source height Bunny reported, which decides which MP4 rendition
  // actually exists (see videoPlaybackUrl).
  height: number | null;
};

// Fills its parent container -- same contract as PhotoGallery and
// SpinViewer, so the media box on ListingDetailScreen doesn't change shape
// depending on which tab is open.
//
// Nothing is downloaded until the buyer taps play. The player is created
// with a null source and only given the URL on press, so a listing page with
// a video costs one small JPEG to open rather than a video's worth of
// someone's mobile data. That also sidesteps every browser's autoplay
// policy instead of fighting it.
export default function VideoPlayer({ guid, height }: Props) {
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  const start = () => {
    try {
      player.replace(videoPlaybackUrl(guid, height));
      player.play();
      setStarted(true);
    } catch {
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <View style={styles.fill}>
        <Text style={type.soft}>This video could not be played.</Text>
      </View>
    );
  }

  if (!started) {
    return (
      <Pressy onPress={start} style={styles.fill}>
        <Image source={{ uri: videoThumbnailUrl(guid) }} style={styles.poster} resizeMode="cover" />
        <View style={styles.playOverlay}>
          <View style={styles.playCircle}>
            {/* No play glyph in the icon set; a border triangle renders
                identically on native and on react-native-web. */}
            <View style={styles.playTriangle} />
          </View>
        </View>
      </Pressy>
    );
  }

  return (
    <View style={styles.fill}>
      <VideoView
        player={player}
        style={fillAbsolute}
        contentFit="contain"
        nativeControls
        // expo-video 57 replaced the old `allowsFullscreen` boolean with
        // this options object -- passing the old prop is a type error, not a
        // silently ignored one.
        fullscreenOptions={{ enable: true }}
        // Web only. Without it, iOS Safari yanks the video into its own
        // fullscreen player the moment it starts, which throws the buyer out
        // of the listing page they were reading.
        playsInline
        allowsPictureInPicture={false}
      />
    </View>
  );
}

// Written out rather than using StyleSheet.absoluteFill: react-native-web's
// typings don't carry absoluteFillObject, and this is unambiguous on both.
const fillAbsolute = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  poster: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  playOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 5,
    borderTopWidth: 11,
    borderBottomWidth: 11,
    borderLeftWidth: 18,
    borderRightWidth: 0,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: 'transparent',
    borderLeftColor: colors.white,
  },
});
