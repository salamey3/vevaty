import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme/theme';
import { LatLng } from '../lib/geo';

// Uber-style pin-drop map for the listing location. Leaflet + OpenStreetMap
// tiles, loaded at runtime via a CDN <script>/<link> injection rather than
// an npm dependency: this repo has zero map library today, no
// metro.config.js/webpack config (so an npm `leaflet` package would have no
// CSS-loader story for leaflet.css), and Leaflet expects window/document at
// module load, which is fragile under Metro's bundler. A runtime-injected
// tag sidesteps all of that and fits how this app already ships as one
// static web bundle. Both unpkg.com and the tile servers below are free, no
// API key, attribution-only. Web-only (Platform.OS === 'web') -- this app
// has no shipped native build today, but a native platform just renders a
// plain hint instead of crashing.
//
// Tiles: CARTO's "Positron" basemap rather than stock OpenStreetMap tiles --
// same free/no-key/attribution-only deal as OSM's own tile server (CARTO
// serves the same OSM data, just pre-styled), but muted and low-contrast
// like Uber/Google's ride-hailing UIs instead of OSM's saturated yellow
// roads and green landuse fills, which is what the user asked to match.
// Pin: a custom L.divIcon (white dot, thick ink-colored ring, small
// floating label pill) standing in for Leaflet's default blue teardrop --
// same visual language as Uber's "Pickup here" pin. Built from colors.ink
// (a CSS var wired to the admin's live brand color) rather than a literal
// hex so the pin recolors automatically if the brand color ever changes.
const LEAFLET_VERSION = '1.9.4';
const LEBANON_CENTER: LatLng = { lat: 33.8547, lng: 35.8623 };
const DEFAULT_ZOOM = 8;
const PIN_ZOOM = 14;
const PIN_SIZE = 22;
const PIN_RING = 5;

// Kept out of the JSX/render path so it's created once, not per-render.
function buildPinIcon(L: any, label?: string) {
  const ringColor = colors.ink;
  const dot = `<div style="width:${PIN_SIZE}px;height:${PIN_SIZE}px;border-radius:999px;background:#fff;border:${PIN_RING}px solid ${ringColor};box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`;
  const pill = label
    ? `<div style="position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:8px;background:${ringColor};color:#fff;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);">
        ${label}
        <div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:5px solid ${ringColor};"></div>
      </div>`
    : '';
  return L.divIcon({
    className: 'vevaty-map-pin',
    html: `<div style="position:relative;width:${PIN_SIZE}px;height:${PIN_SIZE}px;">${pill}${dot}</div>`,
    iconSize: [PIN_SIZE, PIN_SIZE],
    iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
  });
}

let leafletLoadPromise: Promise<any> | null = null;

function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if ((window as any).L) return Promise.resolve((window as any).L);
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
      document.head.appendChild(link);
    }
    const existing = document.getElementById('leaflet-js') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).L));
      existing.addEventListener('error', () => reject(new Error('Failed to load Leaflet')));
      if ((window as any).L) resolve((window as any).L);
      return;
    }
    const script = document.createElement('script');
    script.id = 'leaflet-js';
    script.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
    script.onload = () => resolve((window as any).L);
    script.onerror = () => reject(new Error('Failed to load Leaflet'));
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

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
  // Small floating label pill above the pin, Uber "Pickup here"-style.
  // Omit for a bare dot with no label.
  pinLabel?: string;
  height?: number;
}) {
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;
        const node = containerRef.current as unknown as HTMLElement;
        const map = L.map(node, {
          center: value ? [value.lat, value.lng] : [LEBANON_CENTER.lat, LEBANON_CENTER.lng],
          zoom: value ? PIN_ZOOM : DEFAULT_ZOOM,
        });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          maxZoom: 19,
          subdomains: 'abcd',
          attribution: '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
        }).addTo(map);

        const startLatLng = value ? [value.lat, value.lng] : [LEBANON_CENTER.lat, LEBANON_CENTER.lng];
        const marker = L.marker(startLatLng, { draggable: true, icon: buildPinIcon(L, pinLabel) }).addTo(map);
        markerRef.current = marker;
        mapRef.current = map;
        leafletRef.current = L;

        const emit = (lat: number, lng: number) => onChangeRef.current({ lat, lng });

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          emit(pos.lat, pos.lng);
        });
        map.on('click', (e: any) => {
          marker.setLatLng(e.latlng);
          emit(e.latlng.lat, e.latlng.lng);
        });

        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker/map in sync when `value` changes from outside (e.g. the
  // seller picked a place from the text search, or "Use my location" ran) --
  // but only reposition, never re-init the map instance.
  useEffect(() => {
    if (!ready || !value || !mapRef.current || !markerRef.current) return;
    const current = markerRef.current.getLatLng();
    if (Math.abs(current.lat - value.lat) < 1e-6 && Math.abs(current.lng - value.lng) < 1e-6) return;
    markerRef.current.setLatLng([value.lat, value.lng]);
    mapRef.current.setView([value.lat, value.lng], Math.max(mapRef.current.getZoom(), PIN_ZOOM));
  }, [value, ready]);

  // Rebuild just the icon (not the whole map) if the label text changes --
  // e.g. the seller toggles the AR/EN language switch while this step is
  // still on screen.
  useEffect(() => {
    if (!ready || !leafletRef.current || !markerRef.current) return;
    markerRef.current.setIcon(buildPinIcon(leafletRef.current, pinLabel));
  }, [pinLabel, ready]);

  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.fallback, { height }]}>
        <Text style={styles.fallbackText}>Map location picker is available on the Vevaty web app.</Text>
      </View>
    );
  }

  return (
    <View>
      <View ref={containerRef} style={{ height, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.card }} />
      {loadFailed && <Text style={styles.fallbackText}>{"Couldn't load the map — you can still set your location by typing your town below."}</Text>}
      {!!hint && !loadFailed && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    borderRadius: radius.sm, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  fallbackText: { fontSize: 12.5, color: colors.inkSoft, marginTop: 6 },
  hint: { fontSize: 12, color: colors.inkSoft, marginTop: 6 },
});
