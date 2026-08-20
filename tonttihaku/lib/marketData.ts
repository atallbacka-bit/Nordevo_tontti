// Loaders + geo helpers for the bundled market data in /public/data:
//   postal-areas-pks.json  — Paavo postal areas (simplified polygons + demographics)
//   rail-stations.json     — train/metro/light-rail stations (OSM)
//   amenities-pks.json     — schools, daycares, supermarkets (OSM)

import { haversineKm } from './sthAnalysis';

export interface PostalAreaProps {
    code: string;
    name: string;
    kunta: string;
    pop: number | null;
    avgAge: number | null;
    youngAdultShare: number | null;
    medIncome: number | null;
    hhMedIncome: number | null;
    households: number | null;
    avgHhSize: number | null;
    familyShare: number | null;
    rentalShare: number | null;
    ownerShare: number | null;
    dwellings: number | null;
    ktShare: number | null;
    ptShare: number | null;
    avgDwellingM2: number | null;
    year: number | null;
}

export interface PostalAreaFeature {
    type: 'Feature';
    properties: PostalAreaProps;
    geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: any };
}

export interface PostalAreaFC {
    type: 'FeatureCollection';
    features: PostalAreaFeature[];
}

export interface RailStation {
    name: string;
    type: 'juna' | 'metro' | 'ratikka';
    lat: number;
    lng: number;
    uc?: boolean; // under construction
}

export interface Amenity {
    t: 'koulu' | 'paivakoti' | 'kauppa';
    lat: number;
    lng: number;
}

/** Parcel under the analysis point, from /api/market/property (MML). */
export interface ParcelInfo {
    tunnus: string;           // display form, e.g. 91-14-477-38
    kiinteistotunnus: string; // raw 14-digit id
    areaM2: number | null;
    contained: boolean;       // false = nearest parcel, point itself hit no polygon
    yleinenAlue: boolean;     // street/park parcel (group 9901+)
    geometry: any | null;     // GeoJSON polygon for drawing; null for yleinen alue
}

const cache: Record<string, Promise<any>> = {};

function load<T>(path: string): Promise<T> {
    if (!cache[path]) {
        cache[path] = fetch(path).then(r => {
            if (!r.ok) throw new Error(`Failed to load ${path}`);
            return r.json();
        }).catch(err => {
            delete cache[path];
            throw err;
        });
    }
    return cache[path];
}

export const loadPostalAreas = () => load<PostalAreaFC>('/data/postal-areas-pks.json');
export const loadRailStations = () => load<RailStation[]>('/data/rail-stations.json');
export const loadAmenities = () => load<Amenity[]>('/data/amenities-pks.json');

// ─── Point in polygon ────────────────────────────────────────

function inRing(lng: number, lat: number, ring: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function inPolygon(lng: number, lat: number, poly: number[][][]): boolean {
    if (!poly.length || !inRing(lng, lat, poly[0])) return false;
    for (let i = 1; i < poly.length; i++) {
        if (inRing(lng, lat, poly[i])) return false; // hole
    }
    return true;
}

export function findPostalArea(lat: number, lng: number, fc: PostalAreaFC): PostalAreaFeature | null {
    for (const f of fc.features) {
        const g = f.geometry;
        if (g.type === 'Polygon') {
            if (inPolygon(lng, lat, g.coordinates)) return f;
        } else {
            for (const poly of g.coordinates) {
                if (inPolygon(lng, lat, poly)) return f;
            }
        }
    }
    return null;
}

/** rough centroid from the outer ring's bbox — good enough for neighbor lookups */
export function areaCenter(f: PostalAreaFeature): { lat: number; lng: number } {
    const ring: number[][] = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return { lat: (minY + maxY) / 2, lng: (minX + maxX) / 2 };
}

/** Postal codes whose area lies (approximately) within radiusKm of a point — for comps lookups. */
export function nearbyPostalCodes(lat: number, lng: number, fc: PostalAreaFC, radiusKm: number, max = 5): string[] {
    const containing = findPostalArea(lat, lng, fc);
    const scored = fc.features
        .map(f => ({ f, d: (() => { const c = areaCenter(f); return haversineKm(lat, lng, c.lat, c.lng); })() }))
        .filter(x => x.d <= radiusKm + 1.2)
        .sort((a, b) => a.d - b.d)
        .map(x => x.f.properties.code);
    const out: string[] = [];
    if (containing) out.push(containing.properties.code);
    for (const code of scored) {
        if (!out.includes(code)) out.push(code);
        if (out.length >= max) break;
    }
    return out;
}

// ─── Access scoring ──────────────────────────────────────────

export interface RailAccess {
    nearest: { station: RailStation; distanceKm: number } | null;       // built rail only
    nearestPlanned: { station: RailStation; distanceKm: number } | null; // under construction
    within1km: number;
}

export function railAccess(lat: number, lng: number, stations: RailStation[]): RailAccess {
    let nearest: { station: RailStation; distanceKm: number } | null = null;
    let nearestPlanned: { station: RailStation; distanceKm: number } | null = null;
    let within1km = 0;
    for (const st of stations) {
        const d = haversineKm(lat, lng, st.lat, st.lng);
        if (st.uc) {
            if (!nearestPlanned || d < nearestPlanned.distanceKm) nearestPlanned = { station: st, distanceKm: d };
        } else {
            if (!nearest || d < nearest.distanceKm) nearest = { station: st, distanceKm: d };
            if (d <= 1.0) within1km++;
        }
    }
    return { nearest, nearestPlanned, within1km };
}

export const RAIL_TYPE_LABELS: Record<RailStation['type'], string> = {
    juna: 'Juna-asema',
    metro: 'Metroasema',
    ratikka: 'Pikaratikka',
};

export interface AmenityCounts {
    koulu: number;
    paivakoti: number;
    kauppa: number;
    nearestKoulu: number | null;    // km
    nearestPaivakoti: number | null;
    nearestKauppa: number | null;
}

export function amenityCounts(lat: number, lng: number, amenities: Amenity[], radiusKm = 1.0): AmenityCounts {
    const out: AmenityCounts = { koulu: 0, paivakoti: 0, kauppa: 0, nearestKoulu: null, nearestPaivakoti: null, nearestKauppa: null };
    for (const a of amenities) {
        // cheap prefilter: ~0.03 deg ≈ 3km
        if (Math.abs(a.lat - lat) > 0.045 || Math.abs(a.lng - lng) > 0.09) continue;
        const d = haversineKm(lat, lng, a.lat, a.lng);
        if (d <= radiusKm) out[a.t]++;
        if (a.t === 'koulu' && (out.nearestKoulu == null || d < out.nearestKoulu)) out.nearestKoulu = d;
        if (a.t === 'paivakoti' && (out.nearestPaivakoti == null || d < out.nearestPaivakoti)) out.nearestPaivakoti = d;
        if (a.t === 'kauppa' && (out.nearestKauppa == null || d < out.nearestKauppa)) out.nearestKauppa = d;
    }
    return out;
}

export function fmtKm(km: number | null | undefined): string {
    if (km == null || !isFinite(km)) return '–';
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1).replace('.', ',')} km`;
}
