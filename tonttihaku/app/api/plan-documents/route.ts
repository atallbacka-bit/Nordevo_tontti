import { NextRequest, NextResponse } from 'next/server';
import { fetchPlanDocuments, isValidKaavatunnus, PlanDocuments } from '@/lib/helsinkiPlanDocs';

// Document list + postback form fields for one Helsinki asemakaava.
// GET /api/plan-documents?tunnus=12290
// The client submits the returned form to ptp.hel.fi itself (new tab), so the
// PDF never passes through this server. See lib/helsinkiPlanDocs.ts.

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 300;
const UPSTREAM_TIMEOUT_MS = 15000;

const g = globalThis as any;
if (!g.__planDocCacheV1) g.__planDocCacheV1 = new Map<string, { at: number; data: PlanDocuments }>();
const cache: Map<string, { at: number; data: PlanDocuments }> = g.__planDocCacheV1;

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tunnus = (searchParams.get('tunnus') || '').trim();
    if (!isValidKaavatunnus(tunnus)) {
        return NextResponse.json({ error: 'tunnus (kaavatunnus) is required' }, { status: 400 });
    }

    const hit = cache.get(tunnus);
    if (hit && Date.now() - hit.at < TTL_MS) {
        return NextResponse.json(hit.data, { headers: { 'X-Cache': 'HIT' } });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    try {
        const data = await fetchPlanDocuments(tunnus, ctrl.signal);
        if (cache.size >= MAX_ENTRIES) cache.clear();
        cache.set(tunnus, { at: Date.now(), data });
        return NextResponse.json(data, { headers: { 'X-Cache': 'MISS' } });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('PlanDocuments API:', msg);
        const timedOut = ctrl.signal.aborted;
        return NextResponse.json(
            { error: timedOut ? 'ptp.hel.fi timed out' : 'Plan document lookup failed' },
            { status: timedOut ? 504 : 502 }
        );
    } finally {
        clearTimeout(timer);
    }
}
