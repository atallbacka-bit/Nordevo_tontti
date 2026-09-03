// Travel times from the plot to key destinations, for the deck's
// accessibility table. Car via the public OSRM demo (no key); transit and
// walk via Digitransit/HSL when DIGITRANSIT_KEY is set. Without the key the
// walk column falls back to a distance-based estimate (marked with ≈) and
// transit shows '–'.

import { haversineKm } from '@/lib/sthAnalysis';
import type { RailStation } from '@/lib/marketData';

export interface TravelDest { name: string; lat: number; lng: number }
export interface TravelRow {
    name: string;
    km: number;
    walkMin: number | null; walkEst: boolean;
    carMin: number | null;
    transitMin: number | null;
}

const MALLS: TravelDest[] = [
    { name: 'Mall of Tripla', lat: 60.1986, lng: 24.9323 },
    { name: 'Itis', lat: 60.2113, lng: 25.0827 },
    { name: 'Sello', lat: 60.2179, lng: 24.8105 },
    { name: 'Iso Omena', lat: 60.1609, lng: 24.7383 },
    { name: 'Jumbo', lat: 60.2917, lng: 25.0403 },
    { name: 'Myyrmanni', lat: 60.2612, lng: 24.8547 },
    { name: 'Kauppakeskus Kaari', lat: 60.2497, lng: 24.8848 },
    { name: 'Kamppi', lat: 60.1690, lng: 24.9316 },
    { name: 'REDI', lat: 60.1875, lng: 24.9808 },
    { name: 'Ainoa', lat: 60.1734, lng: 24.8033 },
    { name: 'Columbus', lat: 60.2088, lng: 25.1421 },
];

const KUNTA_CENTERS: Record<string, TravelDest> = {
    espoo: { name: 'Espoon keskus', lat: 60.2055, lng: 24.6559 },
    vantaa: { name: 'Tikkurila', lat: 60.2925, lng: 25.0440 },
    kauniainen: { name: 'Kauniaisten keskusta', lat: 60.2110, lng: 24.7284 },
    kirkkonummi: { name: 'Kirkkonummen keskusta', lat: 60.1236, lng: 24.4385 },
    sipoo: { name: 'Nikkilä', lat: 60.3766, lng: 25.2683 },
    tuusula: { name: 'Hyrylä', lat: 60.4028, lng: 25.0292 },
    kerava: { name: 'Keravan keskusta', lat: 60.4030, lng: 25.1052 },
    'järvenpää': { name: 'Järvenpään keskusta', lat: 60.4736, lng: 25.0899 },
};

const RAUTATIENTORI: TravelDest = { name: 'Päärautatieasema', lat: 60.1719, lng: 24.9414 };

async function withTimeout<T>(p: Promise<T>, ms = 6000): Promise<T | null> {
    return Promise.race([p, new Promise<null>(res => setTimeout(() => res(null), ms))]).catch(() => null);
}

async function osrmCarMin(from: TravelDest, to: TravelDest): Promise<number | null> {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const r = await withTimeout(fetch(url).then(x => x.ok ? x.json() : null));
    const sec = r?.routes?.[0]?.duration;
    return typeof sec === 'number' ? Math.round(sec / 60) : null;
}

async function digitransitMin(from: TravelDest, to: TravelDest, mode: 'WALK' | 'TRANSIT', key: string): Promise<number | null> {
    const modes = mode === 'WALK' ? '[{mode: WALK}]' : '[{mode: TRANSIT}, {mode: WALK}]';
    const q = `{ plan(from: {lat: ${from.lat}, lon: ${from.lng}}, to: {lat: ${to.lat}, lon: ${to.lng}}, numItineraries: 1, transportModes: ${modes}) { itineraries { duration } } }`;
    const r = await withTimeout(fetch('https://api.digitransit.fi/routing/v2/hsl/gtfs/v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'digitransit-subscription-key': key },
        body: JSON.stringify({ query: q }),
    }).then(x => x.ok ? x.json() : null), 8000);
    const sec = r?.data?.plan?.itineraries?.[0]?.duration;
    return typeof sec === 'number' ? Math.round(sec / 60) : null;
}

/** Straight line × 1.35 route factor at 4.7 km/h — used only without a key. */
function walkEstimateMin(km: number): number {
    return Math.round((km * 1.35) / 4.7 * 60);
}

export function pickDestinations(
    lat: number, lng: number, kunta: string | undefined, rail: RailStation[],
): TravelDest[] {
    const dests: TravelDest[] = [];
    const built = rail.filter(s => !s.uc);
    const nearest = built
        .map(s => ({ s, d: haversineKm(lat, lng, s.lat, s.lng) }))
        .sort((a, b) => a.d - b.d)[0];
    if (nearest && nearest.d < 15) {
        const kind = nearest.s.type === 'juna' ? 'asema' : nearest.s.type === 'metro' ? 'metroasema' : 'ratikkapysäkki';
        dests.push({ name: `${nearest.s.name} (${kind})`, lat: nearest.s.lat, lng: nearest.s.lng });
    }
    const mall = MALLS.map(m => ({ m, d: haversineKm(lat, lng, m.lat, m.lng) })).sort((a, b) => a.d - b.d)[0];
    if (mall) dests.push(mall.m);
    const kc = kunta ? KUNTA_CENTERS[kunta.trim().toLowerCase()] : undefined;
    if (kc) dests.push(kc);
    dests.push(RAUTATIENTORI);
    // de-dup near-identical destinations (e.g. nearest station IS the central station)
    const seen: TravelDest[] = [];
    for (const d of dests) {
        if (!seen.some(x => haversineKm(x.lat, x.lng, d.lat, d.lng) < 0.4)) seen.push(d);
    }
    return seen;
}

export async function travelTable(lat: number, lng: number, kunta: string | undefined, rail: RailStation[]): Promise<TravelRow[]> {
    const from: TravelDest = { name: 'Tontti', lat, lng };
    const dests = pickDestinations(lat, lng, kunta, rail);
    const key = process.env.DIGITRANSIT_KEY || process.env.NEXT_PUBLIC_DIGITRANSIT_KEY || '';
    return Promise.all(dests.map(async d => {
        const km = haversineKm(lat, lng, d.lat, d.lng);
        const [carMin, transitMin, walkReal] = await Promise.all([
            osrmCarMin(from, d),
            key ? digitransitMin(from, d, 'TRANSIT', key) : Promise.resolve(null),
            key ? digitransitMin(from, d, 'WALK', key) : Promise.resolve(null),
        ]);
        const useWalk = km <= 6; // beyond that a walk time is noise
        return {
            name: d.name, km,
            walkMin: useWalk ? (walkReal ?? walkEstimateMin(km)) : null,
            walkEst: useWalk && walkReal == null,
            carMin, transitMin,
        };
    }));
}
