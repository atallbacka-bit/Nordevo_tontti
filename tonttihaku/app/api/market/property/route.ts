import { NextRequest, NextResponse } from 'next/server';

const MML_API_KEY = process.env.MML_API_KEY;

// Parcel lookup for a clicked point via MML's open cadastral API
// (kiinteistötietojen kyselypalvelu, PalstanSijaintitiedot).
// GET /api/market/property?lat=60.18&lon=24.92
// Returns the parcel containing the point: kiinteistötunnus (display form),
// approximate area and the boundary polygon for drawing on the map.
// Results are cached in-memory — parcels don't move.

// ~±45 m at 60°N: 1° lat ≈ 111 km, 1° lng ≈ 55.5 km, so lng needs 2× the delta
const DLAT = 0.0004;
const DLNG = 0.0008;

const g = globalThis as any;
if (!g.__parcelCacheV2) g.__parcelCacheV2 = new Map<string, any>();
const cache: Map<string, any> = g.__parcelCacheV2;

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

function containsPoint(geom: any, lng: number, lat: number): boolean {
    if (geom.type === 'Polygon') return inPolygon(lng, lat, geom.coordinates);
    if (geom.type === 'MultiPolygon') return geom.coordinates.some((p: number[][][]) => inPolygon(lng, lat, p));
    return false;
}

/** Shoelace over lat/lng rings projected to local meters — good enough for display. */
function ringAreaM2(ring: number[][]): number {
    if (ring.length < 3) return 0;
    const lat0 = ring[0][1];
    const mLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const mLat = 110574;
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0] * mLng, yi = ring[i][1] * mLat;
        const xj = ring[j][0] * mLng, yj = ring[j][1] * mLat;
        sum += xj * yi - xi * yj;
    }
    return Math.abs(sum) / 2;
}

function polygonAreaM2(geom: any): number {
    const polyArea = (poly: number[][][]) =>
        poly.reduce((acc, ring, i) => acc + (i === 0 ? 1 : -1) * ringAreaM2(ring), 0);
    if (geom.type === 'Polygon') return polyArea(geom.coordinates);
    if (geom.type === 'MultiPolygon') return geom.coordinates.reduce((a: number, p: number[][][]) => a + polyArea(p), 0);
    return 0;
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const lat = parseFloat(searchParams.get('lat') || '');
    const lon = parseFloat(searchParams.get('lon') || '');
    if (!isFinite(lat) || !isFinite(lon)) {
        return NextResponse.json({ error: 'lat and lon are required' }, { status: 400 });
    }

    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (cache.has(key)) return NextResponse.json(cache.get(key));

    try {
        const bbox = `${lon - DLNG},${lat - DLAT},${lon + DLNG},${lat + DLAT}`;
        const credentials = Buffer.from(`${MML_API_KEY}:`).toString('base64');
        const res = await fetch(
            `https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v3/collections/PalstanSijaintitiedot/items?bbox=${bbox}&limit=30`,
            { headers: { 'Authorization': `Basic ${credentials}` } }
        );
        if (!res.ok) {
            console.error('Property API: MML error', res.status, await res.text());
            return NextResponse.json({ error: 'MML lookup failed' }, { status: 502 });
        }
        const data = await res.json();
        const features: any[] = data.features || [];
        if (!features.length) {
            const out = { parcel: null };
            cache.set(key, out);
            return NextResponse.json(out);
        }

        // exact containment first; fall back to the nearest registration point
        let feature = features.find(f => containsPoint(f.geometry, lon, lat)) || null;
        const contained = !!feature;
        if (!feature) {
            let best = Infinity;
            for (const f of features) {
                const c = f.properties?.kiinteistotunnuksenSijainti?.coordinates;
                if (!c) continue;
                const d = (c[0] - lon) ** 2 + (c[1] - lat) ** 2;
                if (d < best) { best = d; feature = f; }
            }
        }
        if (!feature) {
            const out = { parcel: null };
            cache.set(key, out);
            return NextResponse.json(out);
        }

        // group 9901+ = yleinen alue (streets, parks): the id is still the right
        // answer, but the polygon can span a whole district — don't ship it
        const raw: string = feature.properties.kiinteistotunnus || '';
        const yleinenAlue = parseInt(raw.slice(6, 10), 10) >= 9900;
        const out = {
            parcel: {
                tunnus: feature.properties.kiinteistotunnuksenEsitysmuoto,
                kiinteistotunnus: raw,
                areaM2: Math.round(polygonAreaM2(feature.geometry)),
                contained,
                yleinenAlue,
                geometry: yleinenAlue ? null : feature.geometry,
            },
        };
        if (cache.size > 300) cache.clear();
        cache.set(key, out);
        return NextResponse.json(out);
    } catch (error) {
        console.error('Property API: Error:', error);
        return NextResponse.json({ error: 'Property lookup failed' }, { status: 500 });
    }
}
