// STH-Group market data analytics.
//
// The DB stores raw Excel rows keyed by column letter (A..AQ) exactly as the
// DATATAULUKKO sheet lays them out. Snapshots are distinguished by column B
// (TILANNE, e.g. 20260422) — the table may hold several snapshots at once and
// projects are matched across snapshots by address_key.
//
// Column map: A city · B snapshot · C postal+district · D project · E address ·
// F builder · G completion YYYYMM · H financing (V/H) · I plot tenure ·
// J building type · K units · L total m² · M total price · N avg unit m² ·
// O €/m² · P price coverage % · Q notes ("Tontti X eur/m2", "Vuokrattu N") ·
// R price-list changes ("Alas 500-1000 eur/m2", "Uusi") · S sold · T for sale ·
// U sold % · V sold 6mo · W sold 12mo · Y..AG sold by type · AI..AQ unsold by type

export const UNIT_TYPES = ['1H', '1-2H', '2H', '2-3H', '3H', '3-4H', '4H', '4-5H', '5H+'] as const;
const SOLD_KEYS = ['Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG'];
const UNSOLD_KEYS = ['AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP', 'AQ'];

export type ProductClass = 'kt-kompakti' | 'kt-keski' | 'kt-suuri' | 'rivitalo' | 'pientalo';

// Plot tenure changes what the €/m² means: a leasehold price excludes the land,
// so owned-plot and leasehold prices must never be averaged together.
// 'oma' = O · 'vuokra' = V and V-LUN · 'seka' = mixed forms (O&V-LUN), excluded
// from tenure-split medians.
export type TenureGroup = 'oma' | 'vuokra' | 'seka';

export function tenureGroup(plotTenure: string): TenureGroup {
    const t = (plotTenure || '').toUpperCase().trim();
    if (t === 'O') return 'oma';
    if (t === 'V' || t === 'V-LUN') return 'vuokra';
    return 'seka';
}

export const TENURE_GROUP_LABELS: Record<TenureGroup, string> = {
    oma: 'Oma tontti',
    vuokra: 'Vuokratontti',
    seka: 'Sekamuoto',
};

export const PRODUCT_LABELS: Record<ProductClass, string> = {
    'kt-kompakti': 'Kerrostalo, kompakti (<50 m²)',
    'kt-keski': 'Kerrostalo, keskikoko (50–75 m²)',
    'kt-suuri': 'Kerrostalo, suuri (>75 m²)',
    'rivitalo': 'Rivitalo',
    'pientalo': 'Pientalo (PT/ET/OKT)',
};

export interface SthProject {
    key: string;
    snapshot: number;
    city: string;
    postalCode: string;
    district: string;
    name: string;
    address: string;
    builder: string;
    completionYm: number | null;
    completed: boolean;
    financing: string;         // V = vapaarahoitteinen, H = hitas-tyyppinen
    plotTenure: string;        // O / V / V-LUN / O&V-LUN
    buildingType: string;
    units: number;
    totalM2: number;
    totalPrice: number;
    avgSize: number;
    eurM2: number;
    priceCoverage: number;
    notes: string;
    priceChanges: string;
    landCost: number | null;   // €/m² from notes
    rentedOut: number | null;  // units moved to rental, from notes
    priceCut: { min: number; max: number } | null;
    isNew: boolean;
    sold: number;
    forSale: number;
    salesRate: number;
    sold6: number;
    sold12: number;
    soldByType: number[];
    unsoldByType: number[];
    productClass: ProductClass;
    tenure: TenureGroup;
    monthsInventory: number | null; // null = no sales but stock remains ("∞")
    lat: number;
    lng: number;
    // vs. previous snapshot (same address_key)
    deltaSold: number | null;
    deltaMonths: number | null;
    prevEurM2: number | null;
}

export interface DbSalesRow {
    data: Record<string, unknown>;
    lat: number;
    lng: number;
    address_key: string;
}

function n(v: unknown): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
        const f = parseFloat(v.replace(',', '.'));
        return isNaN(f) ? 0 : f;
    }
    return 0;
}

function s(v: unknown): string {
    return v == null ? '' : String(v).trim();
}

function parseSnapshot(v: unknown): number {
    const raw = Math.round(n(v));
    return raw > 20000000 ? raw : 0;
}

/** "Tontti 1623 eur/m2" / "Tontti (50%) 1191 eur/m2" -> 1623 */
function parseLandCost(notes: string): number | null {
    const m = notes.match(/Tontti[^0-9]*?(\d{3,5})\s*eur\/m2/i);
    return m ? parseInt(m[1]) : null;
}

/** "Vuokrattu 20." -> 20 */
function parseRented(notes: string): number | null {
    const m = notes.match(/Vuokrattu\s+(\d+)/i);
    return m ? parseInt(m[1]) : null;
}

/** "Alas 500-1000 eur/m2" / "2. kerran alas, nyt 540-1200 eur/m2" -> {min:500,max:1000} */
function parsePriceCut(changes: string): { min: number; max: number } | null {
    if (!/alas/i.test(changes)) return null;
    const m = changes.match(/(\d{2,5})\s*[-–]\s*(\d{2,5})\s*eur\/m2/i)
        || changes.match(/(\d{2,5})\s*eur\/m2/i);
    if (!m) return { min: 0, max: 0 };
    const min = parseInt(m[1]);
    const max = m[2] ? parseInt(m[2]) : min;
    return { min, max };
}

function classify(buildingType: string, avgSize: number): ProductClass {
    const t = buildingType.toUpperCase();
    if (t.startsWith('KT') || t.startsWith('LT')) {
        if (avgSize < 50) return 'kt-kompakti';
        if (avgSize <= 75) return 'kt-keski';
        return 'kt-suuri';
    }
    if (/(PT|ET|OKT)/.test(t)) return 'pientalo';
    if (/(RT|PKT)/.test(t)) return 'rivitalo';
    return 'pientalo';
}

function ymDiffMonths(a: number, b: number): number {
    const ay = Math.floor(a / 100), am = a % 100;
    const by = Math.floor(b / 100), bm = b % 100;
    return (ay - by) * 12 + (am - bm);
}

export function parseSthRow(row: DbSalesRow): SthProject | null {
    const d = row.data || {};
    const city = s(d['A']);
    const address = s(d['E']);
    if (!city || !address) return null;

    const snapshot = parseSnapshot(d['B']);
    const snapYm = snapshot ? Math.floor(snapshot / 100) : 0;
    const postal = s(d['C']);
    const pm = postal.match(/^(\d{5})\s*(.*)$/);
    const notes = s(d['Q']);
    const changes = s(d['R']);
    const completionYm = n(d['G']) > 190000 ? Math.round(n(d['G'])) : null;
    const units = n(d['K']);
    const sold = n(d['S']);
    const forSale = d['T'] != null ? n(d['T']) : Math.max(0, units - sold);
    const sold12 = n(d['W']);
    const avgSize = n(d['N']);
    const buildingType = s(d['J']);

    let monthsInventory: number | null;
    if (forSale <= 0) monthsInventory = 0;
    else if (sold12 <= 0) monthsInventory = null;
    else monthsInventory = (12 * forSale) / sold12;

    return {
        // two projects can share a street address (e.g. A and B buildings),
        // so identity is address + project name
        key: `${row.address_key}::${s(d['D'])}`,
        snapshot,
        city: city.charAt(0) + city.slice(1).toLowerCase(),
        postalCode: pm ? pm[1] : '',
        district: pm ? pm[2] : postal,
        name: s(d['D']),
        address,
        builder: s(d['F']),
        completionYm,
        completed: completionYm != null && snapYm > 0 ? completionYm <= snapYm : false,
        financing: s(d['H']),
        plotTenure: s(d['I']),
        buildingType,
        units,
        totalM2: n(d['L']),
        totalPrice: n(d['M']),
        avgSize,
        eurM2: n(d['O']),
        priceCoverage: n(d['P']),
        notes,
        priceChanges: changes,
        landCost: parseLandCost(notes),
        rentedOut: parseRented(notes),
        priceCut: parsePriceCut(changes),
        isNew: /uusi/i.test(changes),
        sold,
        forSale,
        salesRate: n(d['U']) || (units > 0 ? (100 * sold) / units : 0),
        sold6: n(d['V']),
        sold12,
        soldByType: SOLD_KEYS.map(k => n(d[k])),
        unsoldByType: UNSOLD_KEYS.map(k => n(d[k])),
        productClass: classify(buildingType, avgSize),
        tenure: tenureGroup(s(d['I'])),
        monthsInventory,
        lat: row.lat,
        lng: row.lng,
        deltaSold: null,
        deltaMonths: null,
        prevEurM2: null,
    };
}

export interface SthDataset {
    snapshot: number;             // latest snapshot, e.g. 20260422
    prevSnapshot: number | null;
    projects: SthProject[];       // latest snapshot only, diffed against previous
    snapshots: number[];          // all snapshots present in DB, desc
}

/** Split raw DB rows into snapshots, keep the latest, diff it against the previous. */
export function buildDataset(rows: DbSalesRow[]): SthDataset {
    const bySnapshot = new Map<number, SthProject[]>();
    for (const row of rows) {
        const p = parseSthRow(row);
        if (!p || !p.snapshot) continue;
        if (!bySnapshot.has(p.snapshot)) bySnapshot.set(p.snapshot, []);
        bySnapshot.get(p.snapshot)!.push(p);
    }
    const snapshots = Array.from(bySnapshot.keys()).sort((a, b) => b - a);
    if (snapshots.length === 0) return { snapshot: 0, prevSnapshot: null, projects: [], snapshots: [] };

    const latest = snapshots[0];
    const prev = snapshots.length > 1 ? snapshots[1] : null;
    const projects = bySnapshot.get(latest)!;

    if (prev != null) {
        const prevMap = new Map<string, SthProject>();
        for (const p of bySnapshot.get(prev)!) prevMap.set(p.key, p);
        const dm = ymDiffMonths(Math.floor(latest / 100), Math.floor(prev / 100));
        for (const p of projects) {
            const old = prevMap.get(p.key);
            if (old) {
                p.deltaSold = p.sold - old.sold;
                p.deltaMonths = dm;
                p.prevEurM2 = old.eurM2 || null;
            }
        }
    }
    return { snapshot: latest, prevSnapshot: prev, projects, snapshots };
}

export function formatSnapshot(snap: number): string {
    if (!snap) return '';
    const st = String(snap);
    return `${st.slice(6, 8)}.${st.slice(4, 6)}.${st.slice(0, 4)}`;
}

export function formatYm(ym: number | null): string {
    if (!ym) return '–';
    return `${ym % 100}/${Math.floor(ym / 100)}`;
}

// ─── Absorption grading ──────────────────────────────────────

export interface AbsorptionGrade {
    id: 'soldout' | 'fast' | 'ok' | 'slow' | 'stuck' | 'frozen' | 'new';
    label: string;
    color: string;
}

/** Grade a project by how fast its stock is moving. */
export function gradeProject(p: SthProject): AbsorptionGrade {
    if (p.forSale <= 0) return { id: 'soldout', label: 'Loppuunmyyty', color: '#64748b' };
    if (p.isNew && p.sold12 <= 0) return { id: 'new', label: 'Uusi kohde', color: '#7c3aed' };
    const mi = p.monthsInventory;
    if (mi == null) return { id: 'frozen', label: 'Ei kauppoja 12 kk', color: '#991b1b' };
    if (mi <= 6) return { id: 'fast', label: 'Myy nopeasti', color: '#16a34a' };
    if (mi <= 12) return { id: 'ok', label: 'Myy hyvin', color: '#65a30d' };
    if (mi <= 24) return { id: 'slow', label: 'Myy hitaasti', color: '#d97706' };
    return { id: 'stuck', label: 'Seisoo', color: '#dc2626' };
}

export function formatMonthsInv(mi: number | null): string {
    if (mi == null) return '∞';
    if (mi === 0) return '0';
    if (mi < 10) return mi.toFixed(1).replace('.', ',');
    return String(Math.round(mi));
}

// ─── Aggregation ─────────────────────────────────────────────

export interface AggStats {
    projects: number;
    units: number;
    sold: number;
    forSale: number;
    sold6: number;
    sold12: number;
    deltaSold: number;
    hasDelta: boolean;
    medEurM2: number | null;          // mixed — only for fallback display
    medEurM2Own: number | null;       // oma tontti only
    medEurM2Lease: number | null;     // vuokratontti only
    ownCount: number;
    leaseCount: number;
    monthsInventory: number | null;
    salesRate: number;
    momentum: number | null;     // annualized 6mo pace vs 12mo pace, 1.0 = flat
    cutShare: number;            // share of projects with price cuts
    pipelineUnits: number;       // unsold units in projects not yet completed
    freeFinanced: number;        // projects with financing V
}

function median(vals: number[]): number | null {
    const v = vals.filter(x => x > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function aggregate(projects: SthProject[]): AggStats {
    const units = projects.reduce((a, p) => a + p.units, 0);
    const sold = projects.reduce((a, p) => a + p.sold, 0);
    const forSale = projects.reduce((a, p) => a + p.forSale, 0);
    const sold6 = projects.reduce((a, p) => a + p.sold6, 0);
    const sold12 = projects.reduce((a, p) => a + p.sold12, 0);
    const withDelta = projects.filter(p => p.deltaSold != null);
    const own = projects.filter(p => p.tenure === 'oma');
    const lease = projects.filter(p => p.tenure === 'vuokra');
    return {
        projects: projects.length,
        units, sold, forSale, sold6, sold12,
        deltaSold: withDelta.reduce((a, p) => a + (p.deltaSold || 0), 0),
        hasDelta: withDelta.length > 0,
        medEurM2: median(projects.map(p => p.eurM2)),
        medEurM2Own: median(own.map(p => p.eurM2)),
        medEurM2Lease: median(lease.map(p => p.eurM2)),
        ownCount: own.length,
        leaseCount: lease.length,
        monthsInventory: forSale <= 0 ? 0 : sold12 > 0 ? (12 * forSale) / sold12 : null,
        salesRate: units > 0 ? (100 * sold) / units : 0,
        momentum: sold12 >= 5 ? (2 * sold6) / sold12 : null,
        cutShare: projects.length ? projects.filter(p => p.priceCut).length / projects.length : 0,
        pipelineUnits: projects.filter(p => !p.completed).reduce((a, p) => a + p.forSale, 0),
        freeFinanced: projects.filter(p => p.financing === 'V').length,
    };
}

// ─── Area (postal code) stats + hotness ──────────────────────

export interface AreaStats extends AggStats {
    code: string;
    hotness: number | null;
    hotnessParts: { imu: number; kysynta: number; momentum: number; paine: number } | null;
    lowConfidence: boolean;
    projectList: SthProject[];
}

function percentileOf(sorted: number[], v: number): number {
    if (!sorted.length) return 50;
    let lo = 0;
    for (const x of sorted) { if (x < v) lo++; else break; }
    return (100 * lo) / sorted.length;
}

/**
 * Composite "kuumuus" score 0–100 per postal area:
 *   40% absorption speed (inverse months of inventory; sold-out areas score top)
 *   25% demand volume (12-mo sales)
 *   20% momentum (last 6 mo annualized vs 12 mo)
 *   15% price stability (few price cuts)
 */
export function computeAreaStats(projects: SthProject[]): Map<string, AreaStats> {
    const byCode = new Map<string, SthProject[]>();
    for (const p of projects) {
        if (!p.postalCode) continue;
        if (!byCode.has(p.postalCode)) byCode.set(p.postalCode, []);
        byCode.get(p.postalCode)!.push(p);
    }
    const areas: AreaStats[] = [];
    byCode.forEach((list, code) => {
        const agg = aggregate(list);
        areas.push({ ...agg, code, hotness: null, hotnessParts: null, lowConfidence: agg.projects < 2 || agg.units < 20, projectList: list });
    });

    // percentile scales across areas; frozen areas (no sales, stock left) score
    // imu 0 directly and are excluded from the comparison scale so they don't
    // deflate every real area's percentile
    const invMonths = areas.filter(a => a.monthsInventory != null).map(a => -a.monthsInventory!).sort((x, y) => x - y);
    const demand = areas.map(a => a.sold12).sort((x, y) => x - y);

    for (const a of areas) {
        const imu = a.monthsInventory == null ? 0 : percentileOf(invMonths, -a.monthsInventory);
        const kysynta = percentileOf(demand, a.sold12);
        const momentum = a.momentum == null ? 50 : Math.max(0, Math.min(100, 50 * a.momentum));
        const paine = 100 * (1 - a.cutShare);
        a.hotnessParts = { imu: Math.round(imu), kysynta: Math.round(kysynta), momentum: Math.round(momentum), paine: Math.round(paine) };
        a.hotness = Math.round(0.40 * imu + 0.25 * kysynta + 0.20 * momentum + 0.15 * paine);
    }
    const out = new Map<string, AreaStats>();
    for (const a of areas) out.set(a.code, a);
    return out;
}

// ─── Point analysis ("what should we build here?") ───────────

export interface ProductRanking {
    class: ProductClass;
    label: string;
    projects: number;
    sold12: number;
    forSale: number;
    monthsInventory: number | null;
    medEurM2Own: number | null;
    medEurM2Lease: number | null;
    medSize: number | null;
    score: number; // rank order helper
}

export interface TenurePrice {
    value: number;
    n: number;
}

export interface TenureSplitPrice {
    oma: TenurePrice | null;
    vuokra: TenurePrice | null;
}

export interface MixGapEntry {
    type: string;
    sold: number;
    unsold: number;
    soldShare: number;
    unsoldShare: number;
    gap: number; // soldShare - unsoldShare: positive = undersupplied
}

export interface BuilderNearby {
    name: string;
    projects: number;
    units: number;
    sold12: number;
    forSale: number;
    monthsInventory: number | null;
}

export interface PipelineEntry {
    project: SthProject;
    distanceKm: number;
}

export interface PointAnalysis {
    lat: number;
    lng: number;
    radiusKm: number;
    nearby: { project: SthProject; distanceKm: number }[];
    stats: AggStats;
    clearingPrice: TenureSplitPrice;   // median €/m² of projects that actually move, per plot tenure
    stalledPrice: TenureSplitPrice;    // median €/m² of stock that doesn't, per plot tenure
    products: ProductRanking[];
    mixGap: MixGapEntry[];
    builders: BuilderNearby[];
    pipeline: PipelineEntry[];                            // completing after snapshot date
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

export function analyzePoint(lat: number, lng: number, radiusKm: number, projects: SthProject[]): PointAnalysis {
    const nearby = projects
        .map(project => ({ project, distanceKm: haversineKm(lat, lng, project.lat, project.lng) }))
        .filter(x => x.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);
    const list = nearby.map(x => x.project);
    const stats = aggregate(list);

    // clearing price: projects that sell (≤12 mo of stock, or sold out with recent
    // sales). Split by plot tenure — leasehold €/m² excludes land, so the two
    // groups are never pooled into one median.
    const movers = list.filter(p => p.sold12 > 0 && (p.monthsInventory == null ? false : p.monthsInventory <= 12) && p.financing === 'V');
    // V-only like the movers: hitas-type (H) asking prices are capped and would
    // deflate the stalled median, manufacturing a false "expensive sells" gap
    const stalled = list.filter(p => p.forSale > 0 && (p.monthsInventory == null || p.monthsInventory > 24) && p.financing === 'V');
    const tenureSplit = (sub: SthProject[]): TenureSplitPrice => {
        const out: TenureSplitPrice = { oma: null, vuokra: null };
        for (const g of ['oma', 'vuokra'] as const) {
            const vals = sub.filter(p => p.tenure === g && p.eurM2 > 0).map(p => p.eurM2);
            const m = median(vals);
            if (m != null) out[g] = { value: m, n: vals.length };
        }
        return out;
    };
    const clearingPrice = tenureSplit(movers);
    const stalledPrice = tenureSplit(stalled);

    // product ranking
    const products: ProductRanking[] = [];
    const classes: ProductClass[] = ['pientalo', 'rivitalo', 'kt-kompakti', 'kt-keski', 'kt-suuri'];
    for (const cls of classes) {
        const sub = list.filter(p => p.productClass === cls);
        if (!sub.length) continue;
        const agg = aggregate(sub);
        const mi = agg.monthsInventory;
        // score: fast absorption + real demand volume
        const score = (mi == null ? 0 : Math.max(0, 36 - mi)) + Math.min(24, agg.sold12);
        products.push({
            class: cls, label: PRODUCT_LABELS[cls],
            projects: sub.length, sold12: agg.sold12, forSale: agg.forSale,
            monthsInventory: mi,
            medEurM2Own: agg.medEurM2Own,
            medEurM2Lease: agg.medEurM2Lease,
            medSize: median(sub.map(p => p.avgSize)),
            score,
        });
    }
    products.sort((a, b) => b.score - a.score);

    // unit mix gap
    const soldTot = UNIT_TYPES.map((_, i) => list.reduce((a, p) => a + p.soldByType[i], 0));
    const unsoldTot = UNIT_TYPES.map((_, i) => list.reduce((a, p) => a + p.unsoldByType[i], 0));
    const soldSum = soldTot.reduce((a, b) => a + b, 0);
    const unsoldSum = unsoldTot.reduce((a, b) => a + b, 0);
    // fold half-types into main types for readability: 1H,2H,3H,4H,5H+
    const foldIdx = [[0, 1], [2, 3], [4, 5], [6, 7], [8]];
    const foldNames = ['1H', '2H', '3H', '4H', '5H+'];
    const mixGap: MixGapEntry[] = foldIdx.map((idxs, i) => {
        const sold = idxs.reduce((a, j) => a + soldTot[j], 0);
        const unsold = idxs.reduce((a, j) => a + unsoldTot[j], 0);
        const soldShare = soldSum > 0 ? sold / soldSum : 0;
        const unsoldShare = unsoldSum > 0 ? unsold / unsoldSum : 0;
        return { type: foldNames[i], sold, unsold, soldShare, unsoldShare, gap: soldShare - unsoldShare };
    });

    // builders
    const byBuilder = new Map<string, SthProject[]>();
    for (const p of list) {
        if (!p.builder || p.builder === 'Ei ole tiedossa') continue;
        if (!byBuilder.has(p.builder)) byBuilder.set(p.builder, []);
        byBuilder.get(p.builder)!.push(p);
    }
    const builders: BuilderNearby[] = Array.from(byBuilder.entries()).map(([name, sub]) => {
        const agg = aggregate(sub);
        return { name, projects: sub.length, units: agg.units, sold12: agg.sold12, forSale: agg.forSale, monthsInventory: agg.monthsInventory };
    }).sort((a, b) => b.sold12 - a.sold12);

    // pipeline: not yet completed
    const pipeline: PipelineEntry[] = nearby
        .filter(x => !x.project.completed && x.project.completionYm != null)
        .sort((a, b) => (a.project.completionYm! - b.project.completionYm!));

    return {
        lat, lng, radiusKm, nearby, stats,
        clearingPrice, stalledPrice,
        products, mixGap, builders, pipeline,
    };
}

// ─── Movers vs stalled: why does some stock sell? ────────────
//
// The user's field observation: selling stock is often MORE expensive than
// stalled stock — price alone doesn't explain absorption. This decomposition
// compares the two groups on the attributes we do observe (product, size,
// tenure, completion state, price-cut history) so the panel can say WHY the
// sellers sell, and show the price inversion when it exists.

export interface GroupProfile {
    n: number;
    medEurM2Own: number | null;
    medEurM2Lease: number | null;
    medAvgSize: number | null;
    ownShare: number;          // own-plot projects / n
    completedShare: number;    // completed projects / n
    cutShare: number;          // projects with a price cut / n
    smallHomeShare: number;    // pientalo + rivitalo / n
    kompaktiShare: number;     // kt-kompakti / n
    medUnits: number | null;
}

/** A comparison finding: Finnish source text plus values for its {placeholders}. */
export interface Reason { fi: string; vars?: Record<string, string | number>; }

/** Render a Reason as plain Finnish — for outputs that are always Finnish (e.g. the pptx deck). */
export function reasonText(r: Reason): string {
    return r.vars ? r.fi.replace(/\{(\w+)\}/g, (m, k) => (k in r.vars! ? String(r.vars![k]) : m)) : r.fi;
}

export interface MoverStalledCompare {
    movers: SthProject[];
    stalled: SthProject[];
    m: GroupProfile;
    s: GroupProfile;
    /** own-plot price gap: movers minus stalled, €/m² (null if either side missing) */
    gapOwn: number | null;
    gapLease: number | null;
    /** true when selling stock prices ABOVE stalled stock on comparable tenure */
    inverted: boolean;
    /** completed projects that still hold unsold stock, and how many units */
    finishedUnsoldUnits: number;
    finishedStalledCount: number;
    /** ready-made Finnish explanation lines, most significant first */
    reasons: Reason[];
}

function profile(list: SthProject[]): GroupProfile {
    const own = list.filter(p => p.tenure === 'oma' && p.eurM2 > 0);
    const lease = list.filter(p => p.tenure === 'vuokra' && p.eurM2 > 0);
    const n = list.length || 1;
    return {
        n: list.length,
        medEurM2Own: median(own.map(p => p.eurM2)),
        medEurM2Lease: median(lease.map(p => p.eurM2)),
        medAvgSize: median(list.map(p => p.avgSize)),
        ownShare: list.filter(p => p.tenure === 'oma').length / n,
        completedShare: list.filter(p => p.completed).length / n,
        cutShare: list.filter(p => p.priceCut).length / n,
        smallHomeShare: list.filter(p => p.productClass === 'pientalo' || p.productClass === 'rivitalo').length / n,
        kompaktiShare: list.filter(p => p.productClass === 'kt-kompakti').length / n,
        medUnits: median(list.map(p => p.units)),
    };
}

export function compareMoversStalled(list: SthProject[]): MoverStalledCompare | null {
    const movers = list.filter(p => p.sold12 > 0 && p.monthsInventory != null && p.monthsInventory <= 12 && p.financing === 'V');
    const stalledAll = list.filter(p => p.forSale > 0 && (p.monthsInventory == null || p.monthsInventory > 24));
    // price comparison is V-only (hitas-type caps would fake a price gap);
    // regulated stalled stock is reported separately as supply overhang
    const stalled = stalledAll.filter(p => p.financing === 'V');
    const regulatedStalled = stalledAll.length - stalled.length;
    if (movers.length < 1 || stalled.length < 1) return null;
    const m = profile(movers), s = profile(stalled);

    const gapOwn = m.medEurM2Own != null && s.medEurM2Own != null ? m.medEurM2Own - s.medEurM2Own : null;
    const gapLease = m.medEurM2Lease != null && s.medEurM2Lease != null ? m.medEurM2Lease - s.medEurM2Lease : null;
    const inverted = (gapOwn != null && gapOwn > 100) || (gapOwn == null && gapLease != null && gapLease > 100);

    // overhang counts include regulated stock — finished unsold units press the
    // market regardless of financing form
    const stalledCompleted = stalledAll.filter(p => p.completed);
    const finishedUnsoldUnits = Math.round(stalledCompleted.reduce((acc, p) => acc + p.forSale, 0));

    // Reasons ranked by what actually predicts absorption in the PKS dataset
    // (empirical audit 8/2026): builder identity is the strongest single
    // predictor, then product class + project scale, supply concentration and
    // stage; absolute €/m² alone predicts almost nothing.
    const reasons: Reason[] = [];
    const enough = movers.length >= 2 && stalled.length >= 2;

    // 1. price direction — name it either way so the reader isn't left guessing
    const gap = gapOwn ?? gapLease;
    if (inverted) {
        reasons.push({ fi: 'Myyvät kohteet ovat n. {v} €/m² kalliimpia kuin seisovat — hinta ei selitä menekkiä tässä, vaan tuote, tekijä ja mikrosijainti.', vars: { v: fmtEur(Math.abs(gap!)) } });
    } else if (gap != null && gap < -300 && enough) {
        reasons.push({ fi: 'Myyvät ovat n. {v} €/m² edullisempia — hinnoittelu alueen kauppatasoon ratkaisee.', vars: { v: fmtEur(Math.abs(gap)) } });
    }

    // 2. builder concentration
    const topBuilder = (list: SthProject[]) => {
        const counts = new Map<string, number>();
        for (const p of list) {
            if (!p.builder || p.builder === 'Ei ole tiedossa') continue;
            counts.set(p.builder, (counts.get(p.builder) || 0) + 1);
        }
        let best: { name: string; n: number } | null = null;
        for (const [name, n] of Array.from(counts.entries())) {
            if (!best || n > best.n) best = { name, n };
        }
        return best;
    };
    const sb = topBuilder(stalled);
    if (sb && sb.n >= 2 && sb.n / stalled.length >= 0.5) {
        reasons.push({ fi: 'Seisova kanta keskittyy yhdelle rakentajalle: {name} ({n} kohdetta) — ongelma voi olla kohde- eikä aluekohtainen.', vars: { name: sb.name, n: sb.n } });
    }
    const mb = topBuilder(movers);
    if (mb && mb.n >= 3 && mb.n / movers.length >= 0.6) {
        reasons.push({ fi: 'Myynti nojaa vahvasti yhteen tekijään: {name} ({n} kohdetta) — konsepti todistetusti toimii täällä.', vars: { name: mb.name, n: mb.n } });
    }

    if (enough) {
        // 3. product class & unit size
        if (m.smallHomeShare - s.smallHomeShare > 0.25) {
            reasons.push({ fi: 'Myyvissä painottuvat pientalot ja rivitalot, seisovissa kerrostalot.' });
        } else if (s.smallHomeShare - m.smallHomeShare > 0.25) {
            reasons.push({ fi: 'Myyvissä painottuvat kerrostalot, seisovissa pientalokohteet.' });
        }
        if (m.medAvgSize != null && s.medAvgSize != null) {
            const sizeDelta = m.medAvgSize - s.medAvgSize;
            if (Math.abs(sizeDelta) >= 8 && Math.abs(m.smallHomeShare - s.smallHomeShare) <= 0.25) {
                const sizeVars = { a: Math.round(m.medAvgSize), b: Math.round(s.medAvgSize) };
                reasons.push(sizeDelta < 0
                    ? { fi: 'Myyvissä asunnot ovat pienempiä (ka. {a} vs {b} m²) — pienempi kokonaishinta liikkuu.', vars: sizeVars }
                    : { fi: 'Myyvissä asunnot ovat suurempia (ka. {a} vs {b} m²) — alue vetää tilaa hakevia.', vars: sizeVars });
            }
        }
        // 4. project scale: small packages clear, big projects stall
        if (m.medUnits != null && s.medUnits != null && s.medUnits - m.medUnits >= 15) {
            reasons.push({ fi: 'Myyvät ovat pienempiä kohteita (md. {a} vs {b} as.) — iso kohde tarvitsee montaa ostajaa samaan aikaan.', vars: { a: Math.round(m.medUnits), b: Math.round(s.medUnits) } });
        }
        // 5. tenure
        if (m.ownShare - s.ownShare > 0.3) {
            reasons.push({ fi: 'Myyvät ovat useammin omalla tontilla — vuokratontti karsii ostajia täällä.' });
        }
        const sekaShare = stalled.filter(p => p.tenure === 'seka').length / stalled.length;
        if (sekaShare >= 0.3) {
            reasons.push({ fi: 'Sekamuotoinen tonttijärjestely (osaomistus) korostuu seisovissa — vaikeasti myytävä rakenne.' });
        }
        // 6. price cuts: cuts tend to RE-ACTIVATE sales; stalled-with-cuts is the hard core
        if (s.cutShare > 0.4 && s.cutShare - m.cutShare > 0.2) {
            reasons.push({ fi: 'Seisovista {p} % on jo laskenut hintaa eikä kauppa silti käy — ongelma tuskin ratkeaa hinnalla.', vars: { p: Math.round(s.cutShare * 100) } });
        } else if (m.cutShare >= 0.3) {
            reasons.push({ fi: 'Osa myyvistä aktivoitui vasta hinnanalennuksen jälkeen ({p} % myyvistä laskenut hintaa).', vars: { p: Math.round(m.cutShare * 100) } });
        }
    }
    // 7. finished-unsold overhang — the hardest evidence of overpricing or wrong product
    if (finishedStockMatters(stalledCompleted.length, finishedUnsoldUnits)) {
        reasons.push({ fi: '{n} valmista kohdetta seisoo myymättä ({u} valmista asuntoa) — valmis varasto painaa koko alueen hintatasoa.', vars: { n: stalledCompleted.length, u: finishedUnsoldUnits } });
    }
    if (regulatedStalled >= 2) {
        reasons.push({ fi: 'Lisäksi {n} säänneltyä kohdetta (hitas/ara-tyyppi) seisoo — eivät mukana hintavertailussa, mutta kilpailevat samoista ostajista.', vars: { n: regulatedStalled } });
    }
    if (inverted && reasons.length === 1) {
        reasons.push({ fi: 'Ero ei selity tuotejaolla — todennäköisiä tekijöitä ovat mikrosijainti (ranta, näkymät, palvelut) ja kohteen laatutaso.' });
    }
    return { movers, stalled, m, s, gapOwn, gapLease, inverted, finishedUnsoldUnits, finishedStalledCount: stalledCompleted.length, reasons };
}

function finishedStockMatters(projects: number, units: number): boolean {
    return projects >= 2 && units >= 15;
}

// ─── Formatting helpers ──────────────────────────────────────

export function fmtEur(v: number | null | undefined, digits = 0): string {
    if (v == null || !isFinite(v)) return '–';
    return Math.round(v).toLocaleString('fi-FI', { maximumFractionDigits: digits });
}

export function fmtPct(v: number | null | undefined): string {
    if (v == null || !isFinite(v)) return '–';
    return `${Math.round(v)} %`;
}
