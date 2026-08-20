import { NextRequest, NextResponse } from 'next/server';

// Realized old-dwelling sales (Tilastokeskus StatFin):
// GET /api/market/resale?postcodes=00530,00640
// €/m² and transaction counts per postal code, from transfer-tax records —
// the ground truth for "does the old stock in this area actually trade, and
// at what price". Complements Oikotie asking prices, which say what sellers
// hope, not what buyers pay.
//
// Sources (audited 8/2026):
//   13mt quarterly — counts are NEVER suppressed ('.' = zero sales); prices
//     ('keskihinta_aritm_nw') need ≥6 price-eligible sales, '...' = withheld.
//   13mu annual   — same dimensions; rescues per-type prices for ~30 PKS
//     postcodes whose quarterly cells are all withheld.
// The newest quarter is preliminary (counts under-report until the final
// release), so 12-month windows exclude it; the series still shows it flagged.
// Postcode lists are filtered against table metadata — 4 PKS codes are absent
// from the dimension and would otherwise fail the whole query.

const BASE = 'https://statfin.stat.fi/PxWeb/api/v1/fi/StatFin/ashi';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_POSTCODES = 8;
const QUARTERS_BACK = 9; // 8-bar series + the windows exclude the preliminary newest

// talotyyppi codes shared by 13mt / 13mu
const TYPES = [
    { code: '1', id: 'kt1', label: 'KT yksiöt' },
    { code: '2', id: 'kt2', label: 'KT kaksiot' },
    { code: '3', id: 'kt3', label: 'KT kolmiot+' },
    { code: '5', id: 'rt', label: 'Rivitalot' },
] as const;

export interface ResaleQuarter {
    q: string;              // e.g. "2025Q3"
    count: number;          // transactions pooled across types
    prelim: boolean;        // newest quarter: preliminary, under-reports
}

export interface ResaleTypePrice {
    id: string;             // kt1 / kt2 / kt3 / rt
    label: string;
    eurM2: number;
    n: number;              // transactions behind the price
    source: 'pooled4q' | 'annual';
}

export interface ResaleArea {
    postcode: string;
    inStatfin: boolean;              // false: postcode absent from the table
    quarters: ResaleQuarter[];       // oldest → newest (newest = preliminary)
    sales12mo: number;               // last 4 COMPLETE quarters, all types (KT+RT osakeasunnot)
    salesPrev12mo: number;           // the 4 quarters before that
    ktSales12mo: number;             // KT types only — pairs with Paavo ktShare-scaled stock
    prices: ResaleTypePrice[];
    ktEurM2: number | null;          // KT types pooled, weighted (quarterly window)
    /** matched-type price change, last 4Q vs prev 4Q: per KT type with quarterly
     *  prices in BOTH windows, ratio weighted by last-4Q counts — immune to the
     *  mix-shift a plain mean-over-means comparison would read as price change */
    trendPct: number | null;
}

const g = globalThis as any;
if (!g.__resaleCache2) {
    g.__resaleCache2 = {
        meta: null as { at: number; quarters: string[]; validCodes: Set<string>; latestYear: string } | null,
        areas: new Map<string, { at: number; area: ResaleArea }>(),
    };
}
const store = g.__resaleCache2;

function parseCount(v: unknown): number {
    // '.' = no transactions; counts are never confidentiality-suppressed
    if (typeof v !== 'string' || !v || v.startsWith('.')) return 0;
    const f = parseFloat(v);
    return isNaN(f) ? 0 : f;
}

function parsePrice(v: unknown): number | null {
    if (typeof v !== 'string' || !v || v.startsWith('.')) return null;
    const f = parseFloat(v);
    return isNaN(f) ? null : f;
}

async function getMeta(): Promise<{ quarters: string[]; validCodes: Set<string>; latestYear: string } | null> {
    if (store.meta && Date.now() - store.meta.at < CACHE_TTL) return store.meta;
    try {
        const [resQ, resA] = await Promise.all([
            fetch(`${BASE}/13mt.px`, { cache: 'no-store' }),
            fetch(`${BASE}/13mu.px`, { cache: 'no-store' }),
        ]);
        if (!resQ.ok) return null;
        const meta = await resQ.json();
        const vars = meta.variables || [];
        const qDim = vars.find((v: any) => v.code === 'timeperiod_q');
        const pcDim = vars.find((v: any) => v.code === 'postinumeroalue_4_20220101');
        if (!qDim?.values?.length || !pcDim?.values?.length) return null;
        const quarters: string[] = qDim.values.slice(-QUARTERS_BACK);
        // annual fallback uses the annual table's own newest year
        let latestYear = String(new Date().getFullYear() - 1);
        if (resA.ok) {
            const metaA = await resA.json();
            const yDim = (metaA.variables || []).find((v: any) => v.code === 'timeperiod_y');
            if (yDim?.values?.length) latestYear = yDim.values[yDim.values.length - 1];
        }
        store.meta = { at: Date.now(), quarters, validCodes: new Set(pcDim.values), latestYear };
        return store.meta;
    } catch {
        return null;
    }
}

async function pxPost(table: string, query: any[]): Promise<any[] | null> {
    try {
        const res = await fetch(`${BASE}/${table}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, response: { format: 'json' } }),
            cache: 'no-store',
        });
        if (!res.ok) return null;
        const data = await res.json();
        return Array.isArray(data?.data) ? data.data : null;
    } catch {
        return null;
    }
}

const sel = (code: string, values: string[]) => ({ code, selection: { filter: 'item', values } });

async function fetchAreas(
    postcodes: string[],
    meta: { quarters: string[]; validCodes: Set<string>; latestYear: string },
): Promise<Map<string, ResaleArea> | null> {
    const valid = postcodes.filter(pc => meta.validCodes.has(pc));
    const out = new Map<string, ResaleArea>();
    for (const pc of postcodes.filter(p => !meta.validCodes.has(p))) {
        out.set(pc, { postcode: pc, inStatfin: false, quarters: [], sales12mo: 0, salesPrev12mo: 0, ktSales12mo: 0, prices: [], ktEurM2: null, trendPct: null });
    }
    if (!valid.length) return out;

    const commonDims = [
        sel('postinumeroalue_4_20220101', valid),
        sel('talotyyppi_6_20131021', TYPES.map(t => t.code)),
        sel('contentscode', ['keskihinta_aritm_nw', 'lkm_julk20']),
    ];
    const [qRows, aRows] = await Promise.all([
        pxPost('13mt.px', [sel('timeperiod_q', meta.quarters), ...commonDims]),
        pxPost('13mu.px', [sel('timeperiod_y', [meta.latestYear]), ...commonDims]),
    ]);
    if (!qRows) return null; // quarterly is essential; annual fallback is best-effort

    // cells: postcode -> quarter -> typeCode -> {price, count}
    const cells = new Map<string, Map<string, Map<string, { price: number | null; count: number }>>>();
    for (const row of qRows) {
        const [q, pc, type] = row.key;
        if (!cells.has(pc)) cells.set(pc, new Map());
        const byQ = cells.get(pc)!;
        if (!byQ.has(q)) byQ.set(q, new Map());
        byQ.get(q)!.set(type, { price: parsePrice(row.values?.[0]), count: parseCount(row.values?.[1]) });
    }
    // annual fallback: postcode -> typeCode -> {price, count}
    const annual = new Map<string, Map<string, { price: number | null; count: number }>>();
    for (const row of aRows || []) {
        const [, pc, type] = row.key;
        if (!annual.has(pc)) annual.set(pc, new Map());
        annual.get(pc)!.set(type, { price: parsePrice(row.values?.[0]), count: parseCount(row.values?.[1]) });
    }

    const series = meta.quarters.slice(-8);
    const prelimQ = meta.quarters[meta.quarters.length - 1];
    const complete = meta.quarters.filter(q => q !== prelimQ);
    const last4 = complete.slice(-4);
    const prev4 = complete.slice(-8, -4);

    for (const pc of valid) {
        const byQ = cells.get(pc);
        const qList: ResaleQuarter[] = series.map(q => ({
            q,
            count: TYPES.reduce((acc, t) => acc + (byQ?.get(q)?.get(t.code)?.count || 0), 0),
            prelim: q === prelimQ,
        }));
        const windowCount = (qs: string[], types: readonly { code: string; id: string }[] = TYPES) => qs.reduce((acc, q) =>
            acc + types.reduce((a2, t) => a2 + (byQ?.get(q)?.get(t.code)?.count || 0), 0), 0);
        const KT_TYPES = TYPES.filter(t => t.id !== 'rt');

        // per-type price: pooled over the window weighted by counts; annual fallback
        const typePrice = (typeCode: string, qs: string[]): { eurM2: number; n: number } | null => {
            let wSum = 0, n = 0;
            for (const q of qs) {
                const c = byQ?.get(q)?.get(typeCode);
                if (c?.price != null && c.count > 0) { wSum += c.price * c.count; n += c.count; }
            }
            return n > 0 ? { eurM2: Math.round(wSum / n), n } : null;
        };
        const prices: ResaleTypePrice[] = [];
        for (const t of TYPES) {
            const p = typePrice(t.code, last4);
            if (p) { prices.push({ id: t.id, label: t.label, ...p, source: 'pooled4q' }); continue; }
            const a = annual.get(pc)?.get(t.code);
            if (a?.price != null) prices.push({ id: t.id, label: t.label, eurM2: Math.round(a.price), n: a.count, source: 'annual' });
        }
        const pooledKt = (qs: string[]) => {
            let wSum = 0, n = 0;
            for (const t of TYPES) {
                if (t.id === 'rt') continue;
                const p = typePrice(t.code, qs);
                if (p) { wSum += p.eurM2 * p.n; n += p.n; }
            }
            return n > 0 ? Math.round(wSum / n) : null;
        };
        let ktEurM2 = pooledKt(last4);
        if (ktEurM2 == null) {
            // annual KT fallback so the price anchor exists even in thin areas
            let wSum = 0, n = 0;
            for (const t of KT_TYPES) {
                const a2 = annual.get(pc)?.get(t.code);
                if (a2?.price != null && a2.count > 0) { wSum += a2.price * a2.count; n += a2.count; }
            }
            if (n > 0) ktEurM2 = Math.round(wSum / n);
        }
        // matched-type trend: only KT types priced (quarterly) in BOTH windows
        let trendW = 0, trendSum = 0;
        for (const t of KT_TYPES) {
            const now = typePrice(t.code, last4);
            const before = typePrice(t.code, prev4);
            if (now && before && before.eurM2 > 0) {
                trendSum += (now.eurM2 / before.eurM2) * now.n;
                trendW += now.n;
            }
        }
        const trendPct = trendW >= 10 ? (trendSum / trendW - 1) * 100 : null;
        out.set(pc, {
            postcode: pc,
            inStatfin: true,
            quarters: qList,
            sales12mo: windowCount(last4),
            salesPrev12mo: windowCount(prev4),
            ktSales12mo: windowCount(last4, KT_TYPES),
            prices,
            ktEurM2,
            trendPct,
        });
    }
    return out;
}

export async function GET(req: NextRequest) {
    const raw = req.nextUrl.searchParams.get('postcodes') || '';
    const postcodes = raw.split(',').map(x => x.trim()).filter(x => /^\d{5}$/.test(x)).slice(0, MAX_POSTCODES);
    if (!postcodes.length) {
        return NextResponse.json({ error: 'postcodes parameter required (comma separated 5-digit codes)' }, { status: 400 });
    }

    const areas: ResaleArea[] = [];
    const missing: string[] = [];
    for (const pc of postcodes) {
        const cached = store.areas.get(pc);
        if (cached && Date.now() - cached.at < CACHE_TTL) areas.push(cached.area);
        else missing.push(pc);
    }

    if (missing.length) {
        const meta = await getMeta();
        const fetched = meta ? await fetchAreas(missing, meta) : null;
        if (fetched) {
            fetched.forEach((area, pc) => {
                store.areas.set(pc, { at: Date.now(), area });
                areas.push(area);
            });
        } else if (!areas.length) {
            return NextResponse.json({ error: 'StatFin ei vastaa' }, { status: 502 });
        }
    }

    areas.sort((a, b) => postcodes.indexOf(a.postcode) - postcodes.indexOf(b.postcode));
    return NextResponse.json({ postcodes, areas, fetchedAt: new Date().toISOString() });
}
