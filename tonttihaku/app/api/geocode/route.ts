import { NextRequest, NextResponse } from 'next/server';

const MML_API_KEY = process.env.MML_API_KEY;

// Geographic-names place type groups worth showing in an address search:
// 301 = towns, urban areas and villages, 302 = districts/parts of towns.
// Everything else (303 houses, terrain features, buildings, transport stops...)
// is noise next to actual addresses.
const SETTLEMENT_GROUPS = new Set([301, 302]);

const MAX_RESULTS = 8;

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const text = searchParams.get('text')?.trim();
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');

    if (!text) {
        return NextResponse.json({ error: 'text parameter is required' }, { status: 400 });
    }

    try {
        const params = new URLSearchParams({
            text,
            sources: 'geographic-names,addresses,interpolated-road-addresses',
            crs: 'EPSG:4326',
            size: '50',
            lang: 'fi',
        });
        // Bias ranking toward the current map view so e.g. "Nummela" finds the
        // nearby town instead of a same-named farm on the other side of Finland
        if (lat && lon) {
            params.set('focus.point.lat', lat);
            params.set('focus.point.lon', lon);
        }

        const credentials = Buffer.from(`${MML_API_KEY}:`).toString('base64');
        const response = await fetch(
            `https://avoin-paikkatieto.maanmittauslaitos.fi/geocoding/v2/pelias/search?${params}`,
            { headers: { 'Authorization': `Basic ${credentials}` } }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Geocode API: MML error:', errorText);
            return NextResponse.json({ error: 'Geocoding failed' }, { status: response.status });
        }

        const data = await response.json();

        // MML's own ordering is unreliable with focus.point (nearby matches can rank
        // below distant ones), so re-rank: exact name matches first, then by distance.
        const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
        const query = norm(text);

        const candidates: { label: string; lat: number; lon: number; exact: number; distance: number }[] = [];
        for (const feature of data.features ?? []) {
            const props = feature.properties ?? {};
            if (props.source === 'geographic-names' && !SETTLEMENT_GROUPS.has(props.placeTypeGroup)) continue;

            const [lng, latitude] = feature.geometry?.coordinates ?? [];
            if (typeof lng !== 'number' || typeof latitude !== 'number') continue;

            // MML labels look like "Koivutie 12 (Akaa)" -> "Koivutie 12, Akaa"
            let label = String(props.label ?? '').replace(/\s*\(([^)]+)\)\s*$/, ', $1').trim();
            // Geographic-names labels carry no municipality ("Nummela") — append it
            const municipality = props['label:municipality'];
            if (props.source === 'geographic-names' && municipality && label !== municipality) {
                label = `${label}, ${municipality}`;
            }
            if (!label) continue;

            // Name variants the user may have typed, with and without municipality
            const names = props.source === 'geographic-names'
                ? [props.label, `${props.label} ${municipality ?? ''}`]
                : [
                    `${props.katunimi ?? ''} ${props.katunumero ?? ''}`,
                    `${props.katunimi ?? ''} ${props.katunumero ?? ''} ${props.kuntanimiFin ?? ''}`,
                    `${props.katunimi ?? ''} ${props.katunumero ?? ''} ${props.kuntanimiSwe ?? ''}`,
                ];
            candidates.push({
                label,
                lat: latitude,
                lon: lng,
                exact: names.some(n => norm(n) === query) ? 0 : 1,
                distance: typeof props.distance === 'number' ? props.distance : Infinity,
            });
        }

        candidates.sort((a, b) => a.exact - b.exact || a.distance - b.distance);

        const results: { lat: string; lon: string; display_name: string }[] = [];
        const seen = new Set<string>();
        for (const c of candidates) {
            if (seen.has(c.label)) continue;
            seen.add(c.label);
            results.push({ lat: String(c.lat), lon: String(c.lon), display_name: c.label });
            if (results.length >= MAX_RESULTS) break;
        }

        return NextResponse.json(results);
    } catch (error) {
        console.error('Geocode API: Error:', error);
        return NextResponse.json({ error: 'Geocoding failed' }, { status: 500 });
    }
}
