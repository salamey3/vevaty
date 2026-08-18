import React, { useMemo, useState } from 'react';
import { Image, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { radius } from '../theme/theme';
import {
  BUNNY_MEDIA_HEADERS,
  videoPlaybackCandidates,
  videoStreamUrl,
  videoThumbnailUrl,
} from '../lib/bunnyVideo';

type Props = {
  guid: string;
  // Rendition heights Bunny actually produced, ascending. Null for videos
  // encoded before we recorded it -- the web player then tries a few likely
  // ones and lets the browser fall through, rather than guessing one and
  // failing silently on a 404.
  resolutions: number[] | null;
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
export default function VideoPlayer({ guid, resolutions }: Props) {
  if (Platform.OS === 'web') return <WebVideo guid={guid} resolutions={resolutions} />;
  return <NativeVideo guid={guid} resolutions={resolutions} />;
}

// Web: a real <video> element rather than expo-video's wrapper, because the
// browser's own controls are the point. Its play button is a genuine user
// gesture on the element itself, so no autoplay policy applies, and there is
// no programmatic play() to be refused.
function WebVideo({ guid, resolutions }: Props) {
  const { width } = useWindowDimensions();
  // A phone browser shows this in a box a few hundred pixels wide, so it asks
  // for the smaller rendition when one exists.
  const candidates = useMemo(
    () => videoPlaybackCandidates(guid, resolutions, width < 700 ? 360 : 720),
    [guid, resolutions, width]
  );

  return (
    <View style={styles.fill}>
      {React.createElement(
        'video',
        {
          // Remount when the list changes, so the browser redoes its source
          // selection instead of staying on a file it already gave up on.
          key: candidates.join('|'),
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
        },
        // Several <source> children rather than one src: if a rendition was
        // never generated the browser moves on to the next instead of showing
        // a dead player. That is the whole reason phone browsers broke while
        // desktop worked.
        ...candidates.map((url) =>
          React.createElement('source', { key: url, src: url, type: 'video/mp4' })
        )
      )}
    </View>
  );
}

// Native: expo-video over the adaptive HLS playlist, which the platform
// player handles itself -- playback starts after one short segment, and the
// bitrate adapts rather than committing to one rendition on mobile data.
//
// The player is created with its source already set, so it is buffering from
// the moment the tab opens.
function NativeVideo({ guid }: Props) {
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
