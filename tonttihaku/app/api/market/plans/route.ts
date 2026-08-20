import { NextResponse } from 'next/server';

// In-preparation detail plans (asemakaavat vireillä) from Helsinki's open WFS.
// The city updates this dataset continuously, so re-fetching daily keeps the
// "kaavat vireillä" layer fresh without any scraping.
// GET /api/market/plans  ->  GeoJSON FeatureCollection (EPSG:4326)

export const dynamic = 'force-dynamic';

const TTL = 24 * 60 * 60 * 1000;

const g = globalThis as any;
if (!g.__plansCache) g.__plansCache = { at: 0, data: null as any };

export async function GET() {
    const cache = g.__plansCache;
    if (cache.data && Date.now() - cache.at < TTL) {
        return NextResponse.json(cache.data);
    }
    try {
        const url = 'https://kartta.hel.fi/ws/geoserver/avoindata/wfs'
            + '?service=WFS&version=2.0.0&request=GetFeature'
            + '&typeName=avoindata:Kaavahakemisto_alue_kaava_vireilla'
            + '&outputFormat=application/json&srsName=EPSG:4326';
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`WFS ${res.status}`);
        const raw = await res.json();
        const features = (raw.features || []).map((f: any) => ({
            type: 'Feature',
            geometry: f.geometry,
            properties: {
                kaavatunnus: f.properties?.kaavatunnus || null,
                hyvaksymispvm: f.properties?.hyvaksymispvm || null,
                luontipvm: f.properties?.luontipvm || null,
                pintaala: f.properties?.pintaala || null,
                city: 'Helsinki',
            },
        }));
        const data = { type: 'FeatureCollection', features, fetchedAt: new Date().toISOString() };
        cache.at = Date.now();
        cache.data = data;
        return NextResponse.json(data);
    } catch (err) {
        console.error('plans route error:', err);
        if (cache.data) return NextResponse.json(cache.data); // serve stale on error
        return NextResponse.json({ type: 'FeatureCollection', features: [], error: 'Kaavadata ei saatavilla' }, { status: 200 });
    }
}
