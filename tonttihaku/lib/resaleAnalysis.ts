// Resale-market ("vanha kanta") analytics: realized sales from Tilastokeskus
// (via /api/market/resale) pooled with live Oikotie listings. This is the
// primary evidence in infill areas where STH tracks few or no new builds:
// realized turnover answers "does this area sell", the asking-vs-realized gap
// and days-on-market answer "how liquid is it", and the realized price level
// anchors a new-build price estimate.

export interface ResaleQuarter { q: string; count: number; prelim: boolean }
export interface ResaleTypePrice { id: string; label: string; eurM2: number; n: number; source: 'pooled4q' | 'annual' }
export interface ResaleArea {
    postcode: string;
    inStatfin: boolean;
    quarters: ResaleQuarter[];
    sales12mo: number;          // last 4 complete quarters (preliminary newest excluded)
    salesPrev12mo: number;
    ktSales12mo: number;        // KT types only
    prices: ResaleTypePrice[];
    ktEurM2: number | null;
    trendPct: number | null;    // matched-type KT price change, computed server-side
}
export interface ResaleResponse { postcodes: string[]; areas: ResaleArea[]; fetchedAt: string; error?: string }

export interface PooledResale {
    postcodes: string[];
    quarters: { q: string; count: number; prelim: boolean }[];  // summed across areas, oldest → newest
    sales12mo: number;
    salesPrev12mo: number;
    ktSales12mo: number;
    prices: ResaleTypePrice[];                  // per type, count-weighted across areas
    ktEurM2: number | null;                     // KT pooled, count-weighted
    trendPct: number | null;                    // matched-type KT price change, sales-weighted across areas
}

/** Pool several postal areas into one radius-level view, weighting prices by transaction counts. */
export function poolResale(allAreas: ResaleArea[]): PooledResale | null {
    const areas = allAreas.filter(a => a.inStatfin && a.quarters.length);
    if (!areas.length) return null;
    // align quarters by LABEL, not position — cached areas can straddle a
    // StatFin release and carry different quarter windows for up to a day
    const byLabel = new Map<string, { count: number; prelim: boolean }>();
    for (const ar of areas) {
        for (const qq of ar.quarters) {
            const cur = byLabel.get(qq.q) || { count: 0, prelim: false };
            cur.count += qq.count;
            cur.prelim = cur.prelim || qq.prelim;
            byLabel.set(qq.q, cur);
        }
    }
    const quarters = Array.from(byLabel.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-8)
        .map(([q, v]) => ({ q, ...v }));
    const byType = new Map<string, { label: string; wSum: number; n: number; hasAnnual: boolean }>();
    for (const ar of areas) {
        for (const p of ar.prices) {
            const t = byType.get(p.id) || { label: p.label, wSum: 0, n: 0, hasAnnual: false };
            t.wSum += p.eurM2 * Math.max(1, p.n);
            t.n += Math.max(1, p.n);
            if (p.source === 'annual') t.hasAnnual = true;
            byType.set(p.id, t);
        }
    }
    const prices: ResaleTypePrice[] = Array.from(byType.entries())
        .map(([id, t]) => ({
            id, label: t.label, eurM2: Math.round(t.wSum / t.n), n: t.n,
            source: (t.hasAnnual ? 'annual' : 'pooled4q') as 'pooled4q' | 'annual',
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    let ktW = 0, ktN = 0, trendW = 0, trendSum = 0;
    for (const ar of areas) {
        if (ar.ktEurM2 != null) {
            const n = ar.prices.filter(p => p.id.startsWith('kt')).reduce((a, p) => a + p.n, 0) || 1;
            ktW += ar.ktEurM2 * n; ktN += n;
        }
        if (ar.trendPct != null && ar.ktSales12mo > 0) {
            trendSum += ar.trendPct * ar.ktSales12mo; trendW += ar.ktSales12mo;
        }
    }
    return {
        postcodes: areas.map(a => a.postcode),
        quarters,
        sales12mo: areas.reduce((a, ar) => a + ar.sales12mo, 0),
        salesPrev12mo: areas.reduce((a, ar) => a + ar.salesPrev12mo, 0),
        ktSales12mo: areas.reduce((a, ar) => a + (ar.ktSales12mo || 0), 0),
        prices,
        ktEurM2: ktN > 0 ? Math.round(ktW / ktN) : null,
        trendPct: trendW > 0 ? trendSum / trendW : null,
    };
}

// ─── Listing-side liquidity (Oikotie) ────────────────────────

export interface ListingLite {
    year: number | null;
    newDev: boolean;
    buildingType: number | null;  // Oikotie: 1 = kerrostalo, 2 = rivitalo, higher = detached etc.
    postcode: string;
    sizeM2: number;
    eurM2: number;
    daysOnMarket: number | null;
    bumped: boolean;
    priceCut: boolean;
    rooms: number | null;
}

/** StatFin's universe is KT+RT osakeasunnot — match listings to it (unknown type kept). */
export function inOsakeFrame(l: ListingLite): boolean {
    return l.buildingType == null || l.buildingType === 1 || l.buildingType === 2;
}

export interface ResaleLiquidity {
    n: number;                        // resale (non-new-dev, KT/RT) listings measured
    domMedian: number | null;         // age of active listings (survives bumps; relist-as-new resets)
    domP75: number | null;
    staleShare: number | null;        // share listed > 90 days
    cutShare: number | null;          // share with a price reduction
    bumpedShare: number | null;       // share renewed/bumped — long runs, still marketed
    activeKtEstimate: number | null;  // est. active KT resale listings (scaled by found)
    monthsInventory: number | null;   // KT frame: active KT resale listings vs realized KT sales pace
    turnoverPct: number | null;       // KT frame: realized KT sales / (dwellings × ktShare), %/year
}

function med(vals: number[]): number | null {
    const v = vals.filter(x => isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function pctl(vals: number[], p: number): number | null {
    const v = vals.filter(x => isFinite(x)).sort((a, b) => a - b);
    if (v.length < 4) return null;
    const idx = (v.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

/**
 * Liquidity of the existing stock, frame-matched to the realized-sales data:
 * every ratio keeps numerator and denominator in the same universe.
 *  - Listings are restricted to the postcodes `resale` actually covers
 *    (postal frame, NOT radius) and to the KT/RT osakeasunto universe.
 *  - Months-of-inventory and turnover are computed KT-only on both sides —
 *    Paavo can't split rivitalo out of its pientalo share, so KT is the only
 *    stock figure both sources agree on.
 * `saleFound` = Oikotie's total match count across ALL building types; the
 * active-stock estimate scales it by the KT share of fetched cards.
 */
export function resaleLiquidity(
    saleListings: ListingLite[],
    saleFound: number,
    resale: PooledResale | null,
    ktDwellings: number | null,      // Σ dwellings × ktShare over the same postcodes
): ResaleLiquidity {
    const inFrame = resale
        ? saleListings.filter(l => resale.postcodes.includes(l.postcode))
        : saleListings;
    const old = inFrame.filter(l => !l.newDev && inOsakeFrame(l));
    const doms = old.map(l => l.daysOnMarket).filter((d): d is number => d != null);
    const oldKt = old.filter(l => l.buildingType === 1);
    const ktOldShare = inFrame.length > 0 ? oldKt.length / inFrame.length : 0;
    const activeKtEstimate = saleFound > 0
        ? Math.round(Math.max(saleFound, inFrame.length) * ktOldShare)
        : (oldKt.length || null);
    const ktSales12 = resale?.ktSales12mo ?? 0;
    return {
        n: old.length,
        domMedian: med(doms),
        domP75: pctl(doms, 0.75),
        staleShare: doms.length >= 5 ? doms.filter(d => d > 90).length / doms.length : null,
        cutShare: old.length >= 5 ? old.filter(l => l.priceCut).length / old.length : null,
        bumpedShare: old.length >= 5 ? old.filter(l => l.bumped).length / old.length : null,
        activeKtEstimate,
        monthsInventory: activeKtEstimate != null && ktSales12 > 0 ? (12 * activeKtEstimate) / ktSales12 : null,
        turnoverPct: ktDwellings && ktDwellings > 0 && ktSales12 > 0 ? (100 * ktSales12) / ktDwellings : null,
    };
}

// ─── Size-band demand from listings (what moves fastest) ─────

export interface BandLiquidity {
    id: string;
    n: number;
    domMedian: number | null;
    cutShare: number | null;
}

export const SIZE_BANDS = [
    { id: '<40', lo: 0, hi: 40 },
    { id: '40–60', lo: 40, hi: 60 },
    { id: '60–80', lo: 60, hi: 80 },
    { id: '80+', lo: 80, hi: 10000 },
] as const;

/** Which unit sizes linger least on the market — a demand signal that works
 *  with zero new-build comparables. Based on active-listing ages, so it reads
 *  "what is NOT piling up", not a realized time-to-sale. */
export function bandLiquidity(saleListings: ListingLite[]): BandLiquidity[] {
    const old = saleListings.filter(l => !l.newDev && inOsakeFrame(l));
    return SIZE_BANDS.map(b => {
        const inBand = old.filter(l => l.sizeM2 >= b.lo && l.sizeM2 < b.hi);
        const doms = inBand.map(l => l.daysOnMarket).filter((d): d is number => d != null);
        return {
            id: b.id,
            n: inBand.length,
            domMedian: doms.length >= 4 ? med(doms) : null,
            cutShare: inBand.length >= 5 ? inBand.filter(l => l.priceCut).length / inBand.length : null,
        };
    });
}

// ─── Liquid price band ───────────────────────────────────────

export type LiquidBandSource = 'movers' | 'movers-converted' | 'resale-premium';

export interface LiquidBand {
    lo: number;
    hi: number;
    source: LiquidBandSource;
    premiumUsed: number | null;     // e.g. 1.28 when derived from resale × premium
    n: number;                      // observations behind the band
}

/** Fallback new-build premium over realized old prices when the local market
 *  offers no observed pair — Helsinki-region typical, flagged in the UI. */
export const DEFAULT_NEW_PREMIUM = 1.30;

/**
 * The price at which a new build should actually move:
 *  1. p25–p75 of selling ("mover") projects' €/m² when we have ≥4 of them;
 *  2. mover median ±5 % when we have 1–3;
 *  3. otherwise realized old-stock €/m² × new-build premium (observed locally
 *     from Oikotie new vs old asking when possible, else DEFAULT_NEW_PREMIUM).
 */
export function liquidPriceBand(
    moverEurM2: number[],            // oma-equivalent €/m² of selling projects
    converted: boolean,              // true if leasehold+plot-estimate conversion was applied
    resaleKtEurM2: number | null,    // realized old KT €/m² (pooled)
    localPremium: number | null,     // Oikotie new asking / old asking, same codes
): LiquidBand | null {
    const movers = moverEurM2.filter(x => isFinite(x) && x > 0).sort((a, b) => a - b);
    if (movers.length >= 4) {
        const lo = pctl(movers, 0.25)!, hi = pctl(movers, 0.75)!;
        const mid = (lo + hi) / 2;
        return {
            lo: Math.round(Math.min(lo, mid * 0.97)),
            hi: Math.round(Math.max(hi, mid * 1.03)),
            source: converted ? 'movers-converted' : 'movers',
            premiumUsed: null,
            n: movers.length,
        };
    }
    if (movers.length >= 1) {
        const m = med(movers)!;
        return {
            lo: Math.round(m * 0.95), hi: Math.round(m * 1.05),
            source: converted ? 'movers-converted' : 'movers',
            premiumUsed: null, n: movers.length,
        };
    }
    if (resaleKtEurM2 != null) {
        const prem = localPremium != null && localPremium > 1.05 && localPremium < 1.9 ? localPremium : DEFAULT_NEW_PREMIUM;
        const mid = resaleKtEurM2 * prem;
        return { lo: Math.round(mid * 0.93), hi: Math.round(mid * 1.07), source: 'resale-premium', premiumUsed: prem, n: 0 };
    }
    return null;
}

// ─── Turnover / DOM grading ──────────────────────────────────

export type LiquidityGrade = 'vilkas' | 'normaali' | 'hidas' | 'jaassa';

export const LIQUIDITY_LABEL: Record<LiquidityGrade, string> = {
    vilkas: 'Vilkas', normaali: 'Normaali', hidas: 'Hidas', jaassa: 'Jäässä',
};
export const LIQUIDITY_COLOR: Record<LiquidityGrade, string> = {
    vilkas: '#16a34a', normaali: '#65a30d', hidas: '#d97706', jaassa: '#dc2626',
};

/** Grade the resale market from realized turnover and listing staleness.
 *  Thresholds calibrated to PKS 8/2026: median postcode ≈ 77 sales/4Q,
 *  old-stock DOM medians 70–115 days in an ordinary suburb. */
export function gradeResale(liq: ResaleLiquidity): LiquidityGrade | null {
    const t = liq.turnoverPct, mi = liq.monthsInventory, dom = liq.domMedian;
    if (t == null && mi == null && dom == null) return null;
    let score = 0, parts = 0;
    if (t != null) { score += t >= 4 ? 2 : t >= 2.5 ? 1 : t >= 1.2 ? -1 : -2; parts++; }
    if (mi != null) { score += mi <= 5 ? 2 : mi <= 9 ? 1 : mi <= 15 ? -1 : -2; parts++; }
    if (dom != null) { score += dom <= 60 ? 2 : dom <= 100 ? 1 : dom <= 150 ? -1 : -2; parts++; }
    const avg = score / parts;
    if (avg >= 1.5) return 'vilkas';
    if (avg >= 0.3) return 'normaali';
    if (avg >= -1.2) return 'hidas';
    return 'jaassa';
}
