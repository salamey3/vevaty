import React, { useMemo, useState } from 'react';
import { Image, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { radius } from '../theme/theme';
import {
  BUNNY_MEDIA_HEADERS,
  videoPlaybackUrl,
  videoStreamUrl,
  videoThumbnailUrl,
} from '../lib/bunnyVideo';

type Props = {
  guid: string;
  // The SOURCE height Bunny reported. Bunny never upscales, so this is what
  // decides which renditions actually exist.
  height: number | null;
};

// Fills its parent container -- same contract as PhotoGallery and SpinViewer,
// so the media box on ListingDetailScreen doesn't change shape depending on
// which tab is open.
//
// This component only mounts when the buyer opens the Videos tab (see
// ListingDetailScreen's mediaBox), which is what makes it safe to start
// loading immediately: a listing page still costs nothing extra to open, but
// by the time somebody has moved their finger to the play button the video is
// already buffered. The first version deferred loading until the tap and then
// called play() programmatically, which was wrong twice over -- it put a
// multi-second stall in front of every play, and on mobile browsers the
// play() call no longer counted as a user gesture, so it was refused outright
// and the video just sat on its first frame forever.
export default function VideoPlayer({ guid, height }: Props) {
  if (Platform.OS === 'web') return <WebVideo guid={guid} height={height} />;
  return <NativeVideo guid={guid} height={height} />;
}

// Web: a real <video> element rather than expo-video's wrapper, because the
// browser's own controls are the point. Its play button is a genuine user
// gesture on the element itself, so no autoplay policy applies, and there is
// no programmatic play() to be refused.
function WebVideo({ guid, height }: Props) {
  const { width } = useWindowDimensions();
  // A phone browser shows this in a box a few hundred pixels wide. Pulling
  // 720p into it costs the buyer roughly three times the data for a
  // difference they cannot see.
  const src = useMemo(
    () => videoPlaybackUrl(guid, height, width < 700 ? 360 : 720),
    [guid, height, width]
  );

  return (
    <View style={styles.fill}>
      {React.createElement('video', {
        key: src,
        src,
        poster: videoThumbnailUrl(guid),
        controls: true,
        preload: 'auto',
        playsInline: true,
        // Attribute spelling, for the browsers that still want it.
        'webkit-playsinline': 'true',
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: '#000000',
          display: 'block',
        },
      })}
    </View>
  );
}

// Native: expo-video over the adaptive HLS playlist, which the platform
// player handles itself -- playback starts after one short segment, and the
// bitrate adapts rather than committing to one rendition on mobile data.
//
// The player is created with its source already set, so it is buffering from
// the moment the tab opens.
function NativeVideo({ guid, height }: Props) {
  const [firstFrame, setFirstFrame] = useState(false);

  const source = useMemo(
    () => ({
      uri: videoStreamUrl(guid),
      // Android and iOS both need telling, since the URL's own extension is
      // the only other hint and iOS in particular ignores tracks without it.
      contentType: 'hls' as const,
      // Without this every request 403s -- see BUNNY_MEDIA_HEADERS. This was
      // the black frame.
      headers: BUNNY_MEDIA_HEADERS,
    }),
    [guid]
  );

  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
  });

  return (
    <View style={styles.fill}>
      <VideoView
        player={player}
        style={fillAbsolute}
        contentFit="contain"
        nativeControls
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={false}
        onFirstFrameRender={() => setFirstFrame(true)}
      />
      {/* Bunny's own thumbnail, covering the black rectangle the player
          shows before it has decoded anything. Removed the instant there is
          a real frame behind it. */}
      {!firstFrame && (
        <View style={styles.poster} pointerEvents="none">
          <Image
            source={{ uri: videoThumbnailUrl(guid), headers: BUNNY_MEDIA_HEADERS }}
            style={styles.poster}
            resizeMode="cover"
          />
        </View>
      )}
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
  poster: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
});
