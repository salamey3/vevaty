import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { MapPressEvent, Marker, MarkerDragStartEndEvent, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { radius } from '../theme/theme';
import { LatLng } from '../lib/geo';

// Native counterpart to LocationMapPicker.web.tsx (Metro picks whichever
// file matches the build platform automatically -- CreateListingScreen's
// `import LocationMapPicker from '../components/LocationMapPicker'` needs
// no change). The web version loads Leaflet via a CDN <script> tag into
// `document`, which only exists in a browser -- there's no equivalent on
// real native rendering, so this uses react-native-maps' native MapView
// instead, backed by Google Maps on Android (PROVIDER_GOOGLE, wired via
// app.json's android.config.googleMaps.apiKey).
//
// NOTE: colors.ink is intentionally NOT used here -- it's a CSS
// var(--vevaty-primary, #hex) string on web (see theme.ts), which native
// color parsing doesn't understand. Hardcoded to match its current hex
// fallback (#2b2b2f) instead. If the admin's live brand color ever needs
// to reach native too, that needs a real runtime value (e.g. site_settings
// state), not this constant -- tracked as a follow-up, not blocking here.
const PIN_INK = '#2b2b2f';

const LEBANON_CENTER: LatLng = { lat: 33.8547, lng: 35.8623 };
// Lebanon's real extent is only ~1.7deg north-south and ~1.5deg east-west
// (33.0-34.7 lat, 35.1-36.6 lng) -- 1.8 covers the whole country with a
// little margin. The web sibling's equivalent is Leaflet zoom 8 (see
// DEFAULT_ZOOM in LocationMapPicker.web.tsx), which frames the same area.
// (Was previously 3.2, which is nearly double the country's actual height --
// that showed Damascus and Haifa, both outside Lebanon, in the initial view.)
const DEFAULT_DELTA = 1.8;
const PIN_DELTA = 0.02;

export default function LocationMapPicker({
  value,
  onChange,
  hint,
  pinLabel,
  height = 220,
}: {
  value: LatLng | null;
  onChange: (coords: LatLng) => void;
  hint?: string;
  pinLabel?: string;
  height?: number;
}) {
  const mapRef = useRef<MapView>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const markerCoord = value ?? LEBANON_CENTER;

  // Keep the map animating to a new `value` set from outside (text search,
  // "Use my location") -- mirrors the web version's sync effect. Doesn't
  // fire on the initial mount, only on later changes, since initialRegion
  // already covers the first render.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!value || !mapRef.current) return;
    mapRef.current.animateToRegion(
      { latitude: value.lat, longitude: value.lng, latitudeDelta: PIN_DELTA, longitudeDelta: PIN_DELTA },
      300
    );
  }, [value]);

  const initialRegion: Region = value
    ? { latitude: value.lat, longitude: value.lng, latitudeDelta: PIN_DELTA, longitudeDelta: PIN_DELTA }
    : { latitude: LEBANON_CENTER.lat, longitude: LEBANON_CENTER.lng, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA };

  return (
    <View>
      <View style={{ height, borderRadius: radius.sm, overflow: 'hidden' }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={initialRegion}
          onPress={(e: MapPressEvent) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            onChangeRef.current({ lat: latitude, lng: longitude });
          }}
        >
          <Marker
            coordinate={{ latitude: markerCoord.lat, longitude: markerCoord.lng }}
            draggable
            onDragEnd={(e: MarkerDragStartEndEvent) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              onChangeRef.current({ lat: latitude, lng: longitude });
            }}
          >
            {/* Custom marker view -- react-native-maps renders arbitrary
                children as the pin image on both platforms, same target-dot
                + floating label look as the web version's divIcon. */}
            <View style={styles.pinWrap}>
              {!!pinLabel && (
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{pinLabel}</Text>
                </View>
              )}
              <View style={styles.dot} />
            </View>
          </Marker>
        </MapView>
      </View>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  pinWrap: { alignItems: 'center' },
  pill: {
    backgroundColor: PIN_INK, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, marginBottom: 6,
  },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  dot: { width: 22, height: 22, borderRadius: 999, backgroundColor: '#fff', borderWidth: 5, borderColor: PIN_INK },
  hint: { fontSize: 12, color: '#7a7a78', marginTop: 6 },
});
