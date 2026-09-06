import { NextRequest, NextResponse } from 'next/server';
import { fetchHelsinkiOwnership, toIdent1, HkiOwnership } from '@/lib/helsinkiOwners';

// Ownership of one parcel from Helsingin karttapalvelu's kiinteistörekisteri.
// GET /api/property-owners?tunnus=91-1-591-2   (also accepts 09100105910002 / 091-001-0591-0002)
// See lib/helsinkiOwners.ts for the data source and its privacy rules.
// Cached in memory for 6 h — register changes are slow and each lookup is
// 3–4 upstream requests.

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const UPSTREAM_TIMEOUT_MS = 15000;

const g = globalThis as any;
if (!g.__ownerCacheV1) g.__ownerCacheV1 = new Map<string, { at: number; data: HkiOwnership }>();
const cache: Map<string, { at: number; data: HkiOwnership }> = g.__ownerCacheV1;

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const ident1 = toIdent1(searchParams.get('tunnus'));
    if (!ident1) {
        return NextResponse.json({ error: 'tunnus (kiinteistötunnus) is required' }, { status: 400 });
    }

    const hit = cache.get(ident1);
    if (hit && Date.now() - hit.at < TTL_MS) {
        return NextResponse.json(hit.data, { headers: { 'X-Cache': 'HIT' } });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    try {
        const data = await fetchHelsinkiOwnership(ident1, ctrl.signal);
        if (cache.size >= MAX_ENTRIES) cache.clear();
        cache.set(ident1, { at: Date.now(), data });
        return NextResponse.json(data, { headers: { 'X-Cache': 'MISS' } });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('PropertyOwners API:', msg);
        const timedOut = ctrl.signal.aborted;
        return NextResponse.json(
            { error: timedOut ? 'kartta.hel.fi timed out' : 'Owner lookup failed' },
            { status: timedOut ? 504 : 502 }
        );
    } finally {
        clearTimeout(timer);
    }
}
