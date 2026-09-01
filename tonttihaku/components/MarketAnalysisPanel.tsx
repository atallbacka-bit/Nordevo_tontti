"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    SthDataset, AreaStats, ProductClass, analyzePoint, formatMonthsInv,
    formatSnapshot, formatYm, fmtEur, haversineKm, gradeProject,
    compareMoversStalled, SthProject,
} from '@/lib/sthAnalysis';
import {
    loadPostalAreas, loadRailStations, loadAmenities,
    findPostalArea, nearbyPostalCodes, railAccess, amenityCounts, fmtKm,
    PostalAreaFC, RailStation, Amenity, ParcelInfo, RAIL_TYPE_LABELS,
} from '@/lib/marketData';
import {
    ResaleResponse, poolResale, resaleLiquidity, bandLiquidity, liquidPriceBand,
    gradeResale, LIQUIDITY_LABEL, LIQUIDITY_COLOR,
} from '@/lib/resaleAnalysis';
import { POSTAL_INFO } from '@/lib/postalInfo';

// One-stop market analysis for a clicked point (or postal area) on the map.
// Layout is verdict-first: the header carries identity (area, kiinteistötunnus),
// then a written area snippet, then an auto-generated plain-language verdict
// next to the hotness score. Detail sections follow, most collapsed.

interface CompListing {
    id: number; url: string; address: string; district: string;
    year: number | null; buildingType: number | null; newDev: boolean;
    rooms: number | null; roomConfig: string;
    sizeM2: number; price: number; eurM2: number;
    lat: number | null; lng: number | null; postcode: string;
    daysOnMarket: number | null; bumped: boolean; priceCut: boolean;
    visits: number | null; visitsWeekly: number | null;
}

interface CompsResponse {
    postcodes: string[]; sale: CompListing[]; rent: CompListing[];
    saleFound?: number; rentFound?: number; fetchedAt: string; error?: string;
}

interface Props {
    open: boolean;
    point: { lat: number; lng: number } | null;
    radiusKm: number;
    onRadiusChange: (r: number) => void;
    dataset: SthDataset;
    areaStats: Map<string, AreaStats>;
    plans: any | null;
    parcel: ParcelInfo | null;
    onClose: () => void;
}

function median(vals: number[]): number | null {
    const v = vals.filter(x => isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[9px] font-bold uppercase tracking-[0.07em] text-slate-400">{children}</div>;
}

function Section({ title, badge, defaultOpen = true, children }: { title: string; badge?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border-b border-slate-100">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50/70 transition-colors">
                <span className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-600">{title}</span>
                    {badge}
                </span>
                <svg className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && <div className="px-4 pb-3.5">{children}</div>}
        </div>
    );
}

function miColor(mi: number | null): string {
    if (mi == null) return '#991b1b';
    if (mi <= 6) return '#16a34a';
    if (mi <= 12) return '#65a30d';
    if (mi <= 24) return '#d97706';
    return '#dc2626';
}

function MonthsChip({ mi }: { mi: number | null }) {
    return (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white tabular-nums" style={{ background: miColor(mi) }}>
            {formatMonthsInv(mi)} kk
        </span>
    );
}

function hotColor(h: number | null): string {
    if (h == null) return '#94a3b8';
    if (h >= 85) return '#dc2626';
    if (h >= 70) return '#f97316';
    if (h >= 55) return '#fbbf24';
    if (h >= 40) return '#a3b18a';
    return '#64748b';
}

function fmtArea(m2: number): string {
    if (m2 >= 10000) return `${(m2 / 10000).toFixed(1).replace('.', ',')} ha`;
    return `${fmtEur(m2)} m²`;
}

const fmt1 = (v: number) => v.toFixed(1).replace('.', ',');

const PRODUCT_SHORT: Record<ProductClass, string> = {
    'kt-kompakti': 'KT kompakti',
    'kt-keski': 'KT keskikoko',
    'kt-suuri': 'KT suuri',
    'rivitalo': 'Rivitalo',
    'pientalo': 'Pientalo',
};

function pct(vals: number[], p: number): number | null {
    const v = vals.filter(x => isFinite(x) && x > 0).sort((a, b) => a - b);
    if (v.length < 4) return null;
    const idx = (v.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

// One axis, every price level on it — the premium is the visible gap.
function PriceLadder({ points }: { points: { label: string; value: number; color: string; hint?: string }[] }) {
    const W = 360, H = 80, y = 42;
    const vals = points.map(p => p.value);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max(150, (hi - lo) * 0.08);
    const x = (v: number) => 14 + ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (W - 28);
    const sorted = [...points].sort((a, b) => a.value - b.value);
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            <line x1={14} y1={y} x2={W - 14} y2={y} stroke="#e2e8f0" strokeWidth={2} strokeLinecap="round" />
            {sorted.map((p, i) => {
                const above = i % 2 === 0; // alternate label sides to dodge collisions
                return (
                    <g key={p.label}>
                        {p.hint && <title>{p.hint}</title>}
                        <circle cx={x(p.value)} cy={y} r={4.5} fill={p.color} />
                        <text x={x(p.value)} y={above ? y - 22 : y + 18} textAnchor="middle" fontSize={8} fill="#64748b" fontWeight={600}>{p.label}</text>
                        <text x={x(p.value)} y={above ? y - 11 : y + 30} textAnchor="middle" fontSize={9.5} fill="#0f172a" fontWeight={800}>{fmtEur(p.value)}</text>
                    </g>
                );
            })}
        </svg>
    );
}

// One row of the answer block: explicit question → answer → one-line basis.
function AnswerRow({ q, basis, children }: { q: string; basis?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="px-3 py-2 flex items-center gap-2.5">
            <div className="w-[74px] flex-none text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400 leading-tight">{q}</div>
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-extrabold leading-tight">{children}</div>
                {basis && <div className="text-[9.5px] text-slate-400 leading-tight mt-0.5">{basis}</div>}
            </div>
        </div>
    );
}

// One cell of the key-numbers grid: label on top, the number big, source under.
function StatTile({ label, note, title, action, children }: { label: string; note?: React.ReactNode; title?: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="bg-white px-3 py-2 min-w-0" title={title}>
            <div className="flex items-center justify-between gap-1">
                <MicroLabel>{label}</MicroLabel>
                {action}
            </div>
            <div className="text-[15px] font-extrabold tabular-nums leading-tight mt-0.5">{children}</div>
            {note && <div className="text-[9px] text-slate-400 leading-tight mt-0.5 truncate">{note}</div>}
        </div>
    );
}

function Unit({ children }: { children: React.ReactNode }) {
    return <span className="text-[9.5px] font-bold text-slate-400 ml-0.5">{children}</span>;
}

const EST_CHIP = <span className="ml-1 text-[8.5px] font-bold text-amber-600 align-middle">arvio</span>;

// Price vs absorption, one dot per project: makes "expensive but selling"
// (and its opposite) visible at a glance. Y grows downward = slower.
// Clicking a dot pins its details below the chart (hover titles don't work on
// touch). Parent gates rendering on scatterEligible().
export function scatterEligible(projects: SthProject[]): SthProject[] {
    return projects.filter(p => p.eurM2 > 0 && p.financing === 'V');
}

function projectInfoLine(p: SthProject): string {
    return `${p.name} · ${fmtEur(p.eurM2)} €/m² (${p.tenure === 'oma' ? 'oma tontti' : p.tenure === 'vuokra' ? 'vuokratontti' : 'seka'}) · ${p.forSale <= 0 ? 'loppuunmyyty' : p.monthsInventory == null ? 'ei kauppoja 12 kk' : `varasto ${formatMonthsInv(p.monthsInventory)} kk`} · ${p.units.toFixed(0)} as.`;
}

function AbsorptionScatter({ projects }: { projects: SthProject[] }) {
    const [sel, setSel] = useState<SthProject | null>(null);
    const pts = scatterEligible(projects);
    if (pts.length < 3) return null;
    const W = 360, H = 148, L = 30, R = 10, T = 12, B = 22;
    const xs = pts.map(p => p.eurM2);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const pad = Math.max(150, (hi - lo) * 0.06);
    const x = (v: number) => L + ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (W - L - R);
    const MI_MAX = 36;
    const y = (mi: number | null) => {
        const v = mi == null ? MI_MAX : Math.min(mi, MI_MAX);
        return T + (v / MI_MAX) * (H - T - B);
    };
    return (
        <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
                {[12, 24].map(g => (
                    <g key={g}>
                        <line x1={L} y1={y(g)} x2={W - R} y2={y(g)} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="3 3" />
                        <text x={L - 3} y={y(g) + 3} textAnchor="end" fontSize={7.5} fill="#94a3b8">{g} kk</text>
                    </g>
                ))}
                <text x={L - 3} y={y(0) + 3} textAnchor="end" fontSize={7.5} fill="#16a34a" fontWeight={700}>myy</text>
                <text x={L - 3} y={y(MI_MAX) + 3} textAnchor="end" fontSize={7.5} fill="#dc2626" fontWeight={700}>seisoo</text>
                <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="#cbd5e1" strokeWidth={1} />
                <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize={8} fill="#64748b" fontWeight={600}>€/m² {lo !== hi ? `(${fmtEur(lo)} – ${fmtEur(hi)})` : ''}</text>
                {pts.map(p => {
                    const grade = gradeProject(p);
                    const r = Math.max(3, Math.min(7, 2 + Math.sqrt(p.units)));
                    const cx = x(p.eurM2), cy = y(p.forSale <= 0 ? 0 : p.monthsInventory);
                    const isSel = sel?.key === p.key;
                    return (
                        <g key={p.key} onClick={() => setSel(isSel ? null : p)} style={{ cursor: 'pointer' }}>
                            <title>{projectInfoLine(p)}</title>
                            {isSel && <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke="#0f172a" strokeWidth={1.5} />}
                            {p.tenure === 'vuokra'
                                ? <circle cx={cx} cy={cy} r={r} fill="none" stroke={grade.color} strokeWidth={2} opacity={0.85} />
                                : <circle cx={cx} cy={cy} r={r} fill={grade.color} opacity={0.8} />}
                        </g>
                    );
                })}
            </svg>
            {sel && (
                <div className="text-[10px] text-slate-700 font-medium bg-slate-50 rounded px-1.5 py-1 -mt-1">
                    {projectInfoLine(sel)}
                </div>
            )}
        </>
    );
}

// Realized transactions per quarter — the newest quarter is preliminary and
// rendered hollow so nobody reads an accruing number as a collapse.
function QuarterBars({ quarters }: { quarters: { q: string; count: number; prelim: boolean }[] }) {
    if (!quarters.length) return null;
    const W = 360, H = 64, B = 14;
    const max = Math.max(1, ...quarters.map(x => x.count));
    const bw = (W - 8) / quarters.length;
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            {quarters.map((qq, i) => {
                const h = Math.max(1.5, ((H - B - 12) * qq.count) / max);
                const xPos = 4 + i * bw;
                return (
                    <g key={qq.q}>
                        <title>{`${qq.q}: ${qq.count} kauppaa${qq.prelim ? ' (ennakkotieto, täydentyy)' : ''}`}</title>
                        <rect x={xPos + 2} y={H - B - h} width={bw - 4} height={h} rx={2}
                            fill={qq.prelim ? 'none' : '#64748b'} stroke={qq.prelim ? '#94a3b8' : 'none'} strokeWidth={qq.prelim ? 1.2 : 0} strokeDasharray={qq.prelim ? '3 2' : undefined} />
                        <text x={xPos + bw / 2} y={H - B - h - 3} textAnchor="middle" fontSize={7.5} fill="#475569" fontWeight={700}>{qq.count}</text>
                        {(i === 0 || i === quarters.length - 1) && (
                            <text x={xPos + bw / 2} y={H - 3} textAnchor="middle" fontSize={7} fill="#94a3b8">{qq.q.replace('Q', '/Q')}{qq.prelim ? '*' : ''}</text>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

// ─── Verdict: the main point, in words ──────────────────────
type Tone = 'pos' | 'neu' | 'neg';
const TONE_COLOR: Record<Tone, string> = { pos: '#16a34a', neu: '#94a3b8', neg: '#dc2626' };
interface VerdictLine { tone: Tone; text: string }

export default function MarketAnalysisPanel({ open, point, radiusKm, onRadiusChange, dataset, areaStats, plans, parcel, onClose }: Props) {
    const [mounted, setMounted] = useState(false);
    const [postalFC, setPostalFC] = useState<PostalAreaFC | null>(null);
    const [rail, setRail] = useState<RailStation[] | null>(null);
    const [amenities, setAmenities] = useState<Amenity[] | null>(null);
    const [comps, setComps] = useState<CompsResponse | null>(null);
    const [compsLoading, setCompsLoading] = useState(false);
    const [compsError, setCompsError] = useState(false);
    const [resale, setResale] = useState<ResaleResponse | null>(null);
    const [resaleLoading, setResaleLoading] = useState(false);
    const [showListings, setShowListings] = useState(false);
    const [listingBucket, setListingBucket] = useState<'vanhat' | 'uudehkot' | 'uudet'>('vanhat');
    const [showScoreParts, setShowScoreParts] = useState(false);
    const [copied, setCopied] = useState(false);
    const [unitCount, setUnitCount] = useState(24);
    // plot-value conversion controls: user-set €/m² override + inline editor,
    // and whether the ladder shows leasehold rungs converted or as-is
    const [plotOverride, setPlotOverride] = useState<number | null>(null);
    const [plotEditing, setPlotEditing] = useState(false);
    const [plotDraft, setPlotDraft] = useState('');
    const [ladderMode, setLadderMode] = useState<'oma' | 'raw'>('oma');

    useEffect(() => { setMounted(true); }, []);
    // a new point is a new site — an override for the old one must not leak in
    useEffect(() => { setPlotOverride(null); setPlotEditing(false); }, [point?.lat, point?.lng]);
    useEffect(() => {
        loadPostalAreas().then(setPostalFC).catch(() => { });
        loadRailStations().then(setRail).catch(() => { });
        loadAmenities().then(setAmenities).catch(() => { });
    }, []);

    useEffect(() => { setCopied(false); }, [parcel?.tunnus]);

    // Oikotie comps + realized sales (Tilastokeskus) for the surrounding postal
    // codes. Old data is cleared immediately when the point moves, so the panel
    // never shows the previous area's numbers under the new area's header.
    useEffect(() => {
        if (!open || !point || !postalFC) return;
        const codes = nearbyPostalCodes(point.lat, point.lng, postalFC, Math.max(1.2, radiusKm), 4);
        if (!codes.length) {
            setComps(null); setResale(null);
            setCompsLoading(false); setResaleLoading(false); setCompsError(false);
            return;
        }
        let cancelled = false;
        setComps(null);
        setResale(null);
        setCompsLoading(true);
        setResaleLoading(true);
        setCompsError(false);
        fetch(`/api/market/comps?postcodes=${codes.join(',')}`)
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(d => { if (!cancelled) setComps(d); })
            .catch(() => { if (!cancelled) { setComps(null); setCompsError(true); } })
            .finally(() => { if (!cancelled) setCompsLoading(false); });
        fetch(`/api/market/resale?postcodes=${codes.join(',')}`)
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(d => { if (!cancelled) setResale(d); })
            .catch(() => { if (!cancelled) setResale(null); })
            .finally(() => { if (!cancelled) setResaleLoading(false); });
        return () => { cancelled = true; };
    }, [open, point?.lat, point?.lng, radiusKm, postalFC]);

    const area = useMemo(() => {
        if (!point || !postalFC) return null;
        return findPostalArea(point.lat, point.lng, postalFC);
    }, [point, postalFC]);

    const areaStat: AreaStats | null = area ? (areaStats.get(area.properties.code) || null) : null;

    const analysis = useMemo(() => {
        if (!point) return null;
        return analyzePoint(point.lat, point.lng, radiusKm, dataset.projects);
    }, [point, radiusKm, dataset]);

    // comps buckets, filtered to actual radius when coordinates exist
    const compStats = useMemo(() => {
        if (!comps || !point) return null;
        const inRadius = (l: CompListing) =>
            l.lat == null || l.lng == null || haversineKm(point.lat, point.lng, l.lat, l.lng) <= radiusKm + 0.6;
        const sale = comps.sale.filter(inRadius);
        const rent = comps.rent.filter(inRadius);
        const nowYear = new Date().getFullYear();
        const uudet = sale.filter(l => l.newDev || (l.year != null && l.year >= nowYear - 1));
        const uudehkot = sale.filter(l => !uudet.includes(l) && l.year != null && l.year >= 2010);
        const vanhat = sale.filter(l => l.year != null && l.year < 2010);
        // rent buckets are exclusive: uudet (≤5 v / uudiskohde) → 2010-luku → vanhat
        const isRentNew = (l: CompListing) => l.newDev || (l.year != null && l.year >= nowYear - 5);
        const rentUudet = rent.filter(isRentNew);
        const rent2010s = rent.filter(l => !isRentNew(l) && l.year != null && l.year >= 2010);
        // old-leaning rents: confirmed-newish excluded, unknown-year kept (skews old)
        const rentOldish = rent.filter(l => !(l.year != null && l.year >= 2010));
        return {
            sale, rent,
            uudet: { med: median(uudet.map(l => l.eurM2)), n: uudet.length, list: uudet },
            uudehkot: { med: median(uudehkot.map(l => l.eurM2)), n: uudehkot.length, list: uudehkot },
            vanhat: { med: median(vanhat.map(l => l.eurM2)), n: vanhat.length, list: vanhat },
            rentAll: { med: median(rent.map(l => l.eurM2)), n: rent.length },
            rentUudet: { med: median(rentUudet.map(l => l.eurM2)), n: rentUudet.length },
            rent2010s: { med: median(rent2010s.map(l => l.eurM2)), n: rent2010s.length },
            rentOld: { med: rentOldish.length >= 3 ? median(rentOldish.map(l => l.eurM2)) : null, n: rentOldish.length },
        };
    }, [comps, point, radiusKm]);

    // Uudisvuokra: an own number for what a NEW unit rents at. Tiered evidence —
    // actual new-build rental listings in the radius, then in the whole postcode
    // set, then 2010s stock as a labeled proxy (est). Old-stock rents are never
    // extrapolated into this: rent spreads don't follow price spreads.
    const rentNew = useMemo(() => {
        if (!comps || !point) return null;
        const nowYear = new Date().getFullYear();
        const isNew = (l: CompListing) => l.newDev || (l.year != null && l.year >= nowYear - 5);
        const isNewish = (l: CompListing) => l.year != null && l.year >= 2010;
        const inRadius = (l: CompListing) =>
            l.lat == null || l.lng == null || haversineKm(point.lat, point.lng, l.lat, l.lng) <= radiusKm + 0.6;
        const tiers: { list: CompListing[]; source: string; est: boolean }[] = [
            { list: comps.rent.filter(l => inRadius(l) && isNew(l)), source: 'uudisvuokrailmoituksista säteellä', est: false },
            { list: comps.rent.filter(isNew), source: 'uudisvuokrailmoituksista lähialueella', est: false },
            { list: comps.rent.filter(l => inRadius(l) && isNewish(l)), source: '2010-luvun kannan vuokrista säteellä', est: true },
            { list: comps.rent.filter(isNewish), source: '2010-luvun kannan vuokrista lähialueella', est: true },
        ];
        for (const t of tiers) {
            if (t.list.length >= 3) {
                const med = median(t.list.map(l => l.eurM2));
                if (med != null) return { med, n: t.list.length, source: t.source, est: t.est };
            }
        }
        return null;
    }, [comps, point, radiusKm]);

    const access = useMemo(() => {
        if (!point || !rail) return null;
        return railAccess(point.lat, point.lng, rail);
    }, [point, rail]);

    const amen = useMemo(() => {
        if (!point || !amenities) return null;
        return amenityCounts(point.lat, point.lng, amenities, 1.0);
    }, [point, amenities]);

    const plansNearby = useMemo(() => {
        if (!point || !plans?.features) return null;
        let count = 0;
        for (const f of plans.features) {
            try {
                const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
                let sx = 0, sy = 0;
                for (const [x, y] of ring) { sx += x; sy += y; }
                const cx = sx / ring.length, cy = sy / ring.length;
                if (haversineKm(point.lat, point.lng, cy, cx) <= radiusKm + 0.3) count++;
            } catch { /* skip malformed */ }
        }
        return count;
    }, [point, plans, radiusKm]);

    if (!mounted || !open || !point) return null;

    const a = analysis!;
    const st = a.stats;
    const hot = areaStat?.hotness ?? null;
    const clearingOma = a.clearingPrice.oma;

    // Leasehold → owned-plot conversion: leasehold €/m² excludes the land, so
    // estimate the plot component and add it. Best source: actual lunastushinnat
    // ("Tontti X eur/m2" in STH notes) on nearby leasehold projects; fallback:
    // the local oma−vuokra clearing spread.
    const landCostsNear = (maxKm: number) => dataset.projects
        .filter(p => p.tenure !== 'oma' && p.landCost != null && p.landCost > 0
            && haversineKm(point.lat, point.lng, p.lat, p.lng) <= maxKm)
        .map(p => p.landCost!);
    let plotEstimate: { value: number; source: string } | null = null;
    {
        const inRadius = median(landCostsNear(radiusKm));
        if (inRadius != null) plotEstimate = { value: inRadius, source: 'lunastushinnoista säteellä' };
        else {
            const nearArea = median(landCostsNear(3));
            if (nearArea != null) plotEstimate = { value: nearArea, source: 'lunastushinnoista ≤3 km' };
            else if (clearingOma && a.clearingPrice.vuokra && clearingOma.value > a.clearingPrice.vuokra.value) {
                plotEstimate = { value: clearingOma.value - a.clearingPrice.vuokra.value, source: 'oma–vuokra-erosta' };
            }
        }
    }
    const plotAutoEstimate = plotEstimate; // data-derived value, kept for the editor's "palauta"
    // user-set value wins everywhere the estimate is used (ladder, likvidi hinta, preemio, tuotto)
    if (plotOverride != null) plotEstimate = { value: plotOverride, source: 'oma arvio' };
    // clearing price on an owned-plot basis: real oma when available, else converted vt
    const omaEquivClearing = clearingOma
        ? { value: clearingOma.value, est: false }
        : a.clearingPrice.vuokra && plotEstimate
            ? { value: a.clearingPrice.vuokra.value + plotEstimate.value, est: true }
            : null;

    const yieldOld = compStats?.rentOld.med && compStats?.vanhat.med ? (12 * compStats.rentOld.med) / compStats.vanhat.med : null;
    const yieldNew = rentNew?.med && omaEquivClearing ? (12 * rentNew.med) / omaEquivClearing.value : null;
    const hasClearing = !!(a.clearingPrice.oma || a.clearingPrice.vuokra);
    const hasStalled = !!(a.stalledPrice.oma || a.stalledPrice.vuokra);
    const whiteSpace = hot != null && hot >= 65 && st.sold12 >= 10 && st.pipelineUnits < Math.max(10, st.sold12 / 2);

    const areaInfo = area ? POSTAL_INFO[area.properties.code] : undefined;

    // biggest genuine unit-mix shortage in the radius (needs some volume behind it)
    const topGap = a.mixGap
        .filter(m => m.gap > 0.08 && m.sold + m.unsold >= 10)
        .sort((x, y) => y.gap - x.gap)[0] || null;

    // ── Resale market (vanha kanta): realized sales + listing liquidity ──
    // Postal frame, not radius: realized counts are per postal code, so every
    // ratio (turnover, months of stock) keeps both sides in the same frame.
    const resalePooled = resale?.areas?.length ? poolResale(resale.areas) : null;
    // KT-frame stock: dwellings × kerrostalo share, over the SAME postcodes the
    // realized counts cover (Paavo can't split rivitalo out of pientalot)
    const pooledCodeSet = new Set(resalePooled?.postcodes ?? []);
    const ktDwellings = postalFC && pooledCodeSet.size
        ? postalFC.features
            .filter(f => pooledCodeSet.has(f.properties.code))
            .reduce((acc, f) => f.properties.dwellings != null && f.properties.ktShare != null
                ? (acc ?? 0) + f.properties.dwellings * f.properties.ktShare : acc, null as number | null)
        : null;
    // StatFin alone still grades turnover when the Oikotie fetch fails
    const resaleLiq = comps || resalePooled
        ? resaleLiquidity(comps?.sale ?? [], comps?.saleFound ?? 0, resalePooled, ktDwellings)
        : null;
    const resaleGrade = resaleLiq ? gradeResale(resaleLiq) : null;
    const sizeBandsLiq = comps ? bandLiquidity(comps.sale) : null;
    const fastestBand = sizeBandsLiq
        ?.filter(b => b.n >= 4 && b.domMedian != null)
        .sort((x, y) => x.domMedian! - y.domMedian!)[0] || null;
    // asking vs realized, like for like: postal-frame KT resale listings vs
    // realized KT sales in the same postcodes
    const askOldKt = comps
        ? median(comps.sale
            .filter(l => !l.newDev && l.buildingType === 1 && (!pooledCodeSet.size || pooledCodeSet.has(l.postcode)))
            .map(l => l.eurM2))
        : null;
    const askOldKtN = comps
        ? comps.sale.filter(l => !l.newDev && l.buildingType === 1 && (!pooledCodeSet.size || pooledCodeSet.has(l.postcode))).length
        : 0;
    const askVsRealized = askOldKt != null && askOldKtN >= 5 && resalePooled?.ktEurM2
        ? askOldKt / resalePooled.ktEurM2 - 1
        : null;
    // new-build premium over the old stock: realized prices preferred as the
    // base, asking as fallback — the base is always named in the UI
    const premiumBase = resalePooled?.ktEurM2 ?? compStats?.vanhat.med ?? null;
    const premiumVsRealized = resalePooled?.ktEurM2 != null;
    const premium = omaEquivClearing && premiumBase ? omaEquivClearing.value / premiumBase - 1 : null;

    const marketLoading = compsLoading || resaleLoading;
    const nKohdetta = (n: number) => `${n} ${n === 1 ? 'kohde' : 'kohdetta'}`;

    // ── Why do some projects sell? (movers vs stalled decomposition) ──
    const radiusProjects = a.nearby.map(x => x.project);
    const cmp = compareMoversStalled(radiusProjects);

    // ── Liquid price band: what a new build actually moves at, oma-equivalent ──
    const moverList = radiusProjects.filter(p =>
        p.sold12 > 0 && p.monthsInventory != null && p.monthsInventory <= 12 && p.financing === 'V');
    const omaMoverVals = moverList.filter(p => p.tenure === 'oma' && p.eurM2 > 0).map(p => p.eurM2);
    const leaseMoverVals = plotEstimate
        ? moverList.filter(p => p.tenure === 'vuokra' && p.eurM2 > 0).map(p => p.eurM2 + plotEstimate!.value)
        : [];
    const bandVals = omaMoverVals.length >= 2 ? omaMoverVals : [...omaMoverVals, ...leaseMoverVals];
    const bandConverted = omaMoverVals.length < 2 && leaseMoverVals.length > 0;
    const localPremium = compStats?.uudet.med && compStats?.vanhat.med && compStats.uudet.n >= 3 && compStats.vanhat.n >= 3
        ? compStats.uudet.med / compStats.vanhat.med
        : null;
    const liquidBand = liquidPriceBand(bandVals, bandConverted, resalePooled?.ktEurM2 ?? null, localPremium);

    // ── "Myykö alue?" — new-build evidence first, resale evidence in infill ──
    const sthThin = st.projects < 3;
    let areaVerdict: { label: string; color: string; basis: string; source: 'uudis' | 'vanha' } | null = null;
    {
        const mi = st.monthsInventory;
        const kauppaa = `${st.sold12.toFixed(0)} uudiskauppa${Math.round(st.sold12) === 1 ? '' : 'a'} 12 kk`;
        if (!sthThin) {
            if (mi != null && mi <= 10 && st.sold12 >= 8) {
                areaVerdict = { label: 'Kyllä', color: '#16a34a', basis: `${kauppaa} · varasto ${formatMonthsInv(mi)} kk`, source: 'uudis' };
            } else if (mi != null && mi <= 18) {
                areaVerdict = { label: 'Kohtalaisesti', color: '#d97706', basis: `${kauppaa} · varasto ${formatMonthsInv(mi)} kk`, source: 'uudis' };
            } else {
                areaVerdict = { label: 'Heikosti', color: '#dc2626', basis: mi == null ? `${st.forSale.toFixed(0)} as. myynnissä, ei kauppoja 12 kk` : `varasto riittäisi ${formatMonthsInv(mi)} kk`, source: 'uudis' };
            }
        } else if (resaleGrade && resaleLiq && resalePooled) {
            const miTxt = resaleLiq.monthsInventory != null ? ` · varasto ≈ ${formatMonthsInv(resaleLiq.monthsInventory)} kk (KT)` : '';
            const basis = `Vanha kanta: ${resalePooled.sales12mo} kauppaa 12 kk${miTxt}`;
            if (resaleGrade === 'vilkas' || resaleGrade === 'normaali') {
                areaVerdict = { label: resaleGrade === 'vilkas' ? 'Kyllä' : 'Kyllä, maltilla', color: resaleGrade === 'vilkas' ? '#16a34a' : '#65a30d', basis, source: 'vanha' };
            } else {
                areaVerdict = { label: resaleGrade === 'hidas' ? 'Vaimeasti' : 'Heikosti', color: LIQUIDITY_COLOR[resaleGrade], basis, source: 'vanha' };
            }
        }
    }

    // "Mitä rakentaa" in infill mode: resale demand signal + housing-stock shape
    const ap = area?.properties;
    const infillBuild = sthThin && (fastestBand || ap?.ktShare != null)
        ? {
            label: `${ap?.ktShare != null && ap.ktShare < 0.45 ? 'Rivitalo / pientalo' : 'Kerrostalo'}${fastestBand ? `, ${fastestBand.id} m²` : ''}`,
            basis: fastestBand ? `${fastestBand.id} m² viipyy myynnissä lyhimpään` : 'alueen asuntokannan rakenne',
        }
        : null;

    // ── Huomiot: only the signals the structured display does NOT already
    //    carry — evidence caveats, warnings, and genuine opportunities. The
    //    old descriptive verdict prose duplicated the answer rows, tiles and
    //    ladder, which made the panel read heavy; those lines are gone. ──
    const signals: VerdictLine[] = [];
    {
        if (st.projects === 0) {
            signals.push({ tone: 'neu', text: 'Ei STH-uudiskohteita säteellä — arvio nojaa vanhan kannan kauppaan.' });
        } else if (sthThin) {
            signals.push({ tone: 'neu', text: `Vain ${st.projects} uudiskohde${st.projects > 1 ? 'tta' : ''} säteellä — ohut uudisnäyttö, vanhan kannan kauppa painaa arviossa.` });
        }
        if (!sthThin && (resaleGrade === 'jaassa' || resaleGrade === 'hidas') && resalePooled && resaleLiq) {
            signals.push({ tone: 'neg', text: `Myös vanha kanta liikkuu hitaasti (${resalePooled.sales12mo} kauppaa 12 kk${resaleLiq.domMedian != null ? `, ilmoitukset md ${Math.round(resaleLiq.domMedian)} vrk vanhoja` : ''}).` });
        }
        if (sthThin && askVsRealized != null && askVsRealized > 0.12) {
            signals.push({ tone: 'neg', text: `Pyynnit ${Math.round(askVsRealized * 100)} % yli toteutuneiden — vanhan kannan pyyntitasoon ei kannata ankkuroitua.` });
        }
        // when price does NOT explain absorption, say why the sellers sell
        if (cmp && cmp.reasons.length > 0 && cmp.inverted) {
            signals.push({ tone: 'neu', text: cmp.reasons[0] });
        }
        if (premium != null && premium > 0.55) {
            signals.push({ tone: 'neg', text: `Uudispreemio vanhaan kantaan +${Math.round(premium * 100)} % (vs. ${premiumVsRealized ? 'toteutuneet kaupat' : 'pyyntihinnat'}) — korkea preemio hidastaa myyntiä.` });
        }
        if (whiteSpace) {
            signals.push({ tone: 'pos', text: `Valkoinen alue: kysyntä vetää, mutta tulevaa tarjontaa on vain ${st.pipelineUnits.toFixed(0)} asuntoa.` });
        } else if (st.projects > 0 && st.pipelineUnits > Math.max(20, st.sold12 * 1.5)) {
            signals.push({ tone: 'neg', text: `Keskeneräisissä kohteissa ${st.pipelineUnits.toFixed(0)} myymätöntä asuntoa — tuleva tarjonta painaa markkinaa.` });
        }
    }

    const copyTunnus = () => {
        if (!parcel) return;
        navigator.clipboard?.writeText(parcel.tunnus).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        }).catch(() => { });
    };

    const savePlot = () => {
        const v = parseInt(plotDraft, 10);
        if (isFinite(v) && v > 0) setPlotOverride(v);
        else setPlotOverride(null);
        setPlotEditing(false);
    };

    // the conversion, in one breath — shown on the tile tooltip and in the editor
    const PLOT_EXPLAIN = 'Vuokratonttikohteen €/m²-hinta ei sisällä tonttia. Omistusvertailussa vuokratonttihintoihin lisätään tontin arvo asuntoneliötä kohden, jotta ne ovat vertailukelpoisia oman tontin hintojen kanssa.';

    // Likvidi hinta tile: one truncating line on the tile, full story on hover
    const liquidNote = liquidBand
        ? liquidBand.source === 'movers'
            ? `myyvät kohteet, oma tontti (${liquidBand.n})`
            : liquidBand.source === 'movers-converted'
                ? (omaMoverVals.length > 0
                    ? `myyvät: ${omaMoverVals.length} oma + ${leaseMoverVals.length} vt + tontti`
                    : `myyvät vt-kohteet + tontin arvo (${liquidBand.n})`)
                : 'vanha toteutunut + uudispreemio'
        : undefined;
    const liquidTitle = liquidBand
        ? liquidBand.source === 'movers' ? `Myyvien uudiskohteiden taso omalla tontilla (${nKohdetta(liquidBand.n)})`
            : liquidBand.source === 'movers-converted'
                ? (omaMoverVals.length > 0
                    ? `Myyvät: ${nKohdetta(omaMoverVals.length)} omalla tontilla + ${leaseMoverVals.length} vuokratontilla tontin arvolla${plotEstimate ? ` ${fmtEur(plotEstimate.value)} €/m²` : ''}`
                    : `Myyvät vuokratonttikohteet + tontin arvo${plotEstimate ? ` ${fmtEur(plotEstimate.value)} €/m²` : ''} (${nKohdetta(liquidBand.n)})`)
                : `Arvio: toteutunut vanha ${fmtEur(resalePooled?.ktEurM2)} €/m² + uudispreemio ${liquidBand.premiumUsed ? `${Math.round((liquidBand.premiumUsed - 1) * 100)} %` : ''}`
        : undefined;

    // Oikotie reference listings, browsable by age bucket (old stock included)
    const listingDist = (l: CompListing) =>
        l.lat != null && l.lng != null ? haversineKm(point.lat, point.lng, l.lat, l.lng) : null;
    const bucketListings = compStats
        ? [...compStats[listingBucket].list].sort((x, y) => (listingDist(x) ?? 99) - (listingDist(y) ?? 99))
        : [];

    // ── The answers: top product + sell-out estimate ──
    const topProduct = st.projects > 0 ? a.products[0] || null : null;
    // months to clear existing product stock + your units at the current pace
    const sellout = topProduct && topProduct.sold12 > 0
        ? Math.round(12 * (unitCount + topProduct.forSale) / topProduct.sold12)
        : null;

    // ── Price ladder: every price level on one owned-plot axis. Leasehold
    // prices are converted (+ plot estimate) so the rungs are comparable;
    // converted rungs carry a * and the footnote states the estimate. ──
    const HINT_KAUPPAAVA = 'Myyvien uudiskohteiden pyyntimediaani — kohteet joiden varasto kiertäisi ≤ 12 kk';
    const HINT_SEISOVA = 'Seisovien uudiskohteiden pyyntimediaani — yli 24 kk varasto tai ei kauppoja 12 kk:ssa';
    const ladder: { label: string; value: number; color: string; hint?: string }[] = [];
    if (resalePooled?.ktEurM2) ladder.push({ label: 'Toteutunut', value: resalePooled.ktEurM2, color: '#7c3aed', hint: 'Tilastokeskus: vanhojen kerrostaloasuntojen TOTEUTUNEET kaupat lähialueen postinumeroilla, 4 viim. neljännestä — mitä ostajat oikeasti maksavat' });
    if (compStats?.vanhat.med) ladder.push({ label: 'Vanhat', value: compStats.vanhat.med, color: '#94a3b8', hint: 'Oikotie: ennen 2010 valmistuneiden pyyntimediaani' });
    if (compStats?.uudehkot.med) ladder.push({ label: '2010-l.', value: compStats.uudehkot.med, color: '#cbd5e1', hint: 'Oikotie: 2010-luvulla valmistuneiden pyyntimediaani' });
    if (compStats?.uudet.med) ladder.push({ label: 'Uudet pyynti', value: compStats.uudet.med, color: '#3b82f6', hint: 'Oikotie: uusien kohteiden pyyntimediaani (kaikki, ei vain myyvät)' });
    // leasehold rungs follow the toggle: 'oma' converts them (+ tonttiarvio) so
    // every rung sits on the same owned-plot axis, 'raw' shows the asking price
    // as printed (without the land component)
    const convertLease = !!plotEstimate && ladderMode === 'oma';
    if (clearingOma) ladder.push({ label: 'Kauppaava', value: clearingOma.value, color: '#16a34a', hint: HINT_KAUPPAAVA });
    if (a.clearingPrice.vuokra) {
        if (convertLease) ladder.push({ label: clearingOma ? 'Kaupp. vt*' : 'Kauppaava*', value: a.clearingPrice.vuokra.value + plotEstimate!.value, color: '#0d9488', hint: `${HINT_KAUPPAAVA} (vuokratontti + tonttiarvio)` });
        else if (ladderMode === 'raw' || !clearingOma) ladder.push({ label: clearingOma ? 'Kaupp. (vt)' : 'Kauppaava (vt)', value: a.clearingPrice.vuokra.value, color: clearingOma ? '#0d9488' : '#16a34a', hint: `${HINT_KAUPPAAVA} (vuokratontti, ilman tonttia)` });
    }
    if (a.stalledPrice.oma) ladder.push({ label: 'Seisova', value: a.stalledPrice.oma.value, color: '#dc2626', hint: HINT_SEISOVA });
    else if (a.stalledPrice.vuokra) {
        if (convertLease) ladder.push({ label: 'Seisova*', value: a.stalledPrice.vuokra.value + plotEstimate!.value, color: '#dc2626', hint: `${HINT_SEISOVA} (vuokratontti + tonttiarvio)` });
        else ladder.push({ label: 'Seisova (vt)', value: a.stalledPrice.vuokra.value, color: '#dc2626', hint: `${HINT_SEISOVA} (vuokratontti, ilman tonttia)` });
    }
    // toggle is only offered when both views exist: a plot value to convert
    // with AND at least one leasehold price on the ladder
    const ladderCanToggle = !!plotEstimate && !!(a.clearingPrice.vuokra || (!a.stalledPrice.oma && a.stalledPrice.vuokra));
    const ladderConverted = ladder.some(p => p.label.includes('*'));
    // unconverted leasehold rungs (no plot estimate available) break the
    // owned-plot comparison — the axis label and footnote must say so
    const ladderUnconverted = ladder.some(p => p.label.includes('(vt)'));
    const ladderHasRealized = ladder.some(p => p.label === 'Toteutunut');

    // ── Oikotie deep-dive: price/premium/yield by size band, dispersion, resale mix ──
    const yieldBase = omaEquivClearing?.value ?? null;
    const bandStats = compStats
        ? [
            { id: '<40', lo: 0, hi: 40 },
            { id: '40–60', lo: 40, hi: 60 },
            { id: '60–80', lo: 60, hi: 80 },
            { id: '80+', lo: 80, hi: 10000 },
        ].map(b => {
            const inBand = (l: CompListing) => l.sizeM2 >= b.lo && l.sizeM2 < b.hi;
            const olds = compStats.vanhat.list.filter(inBand).map(l => l.eurM2);
            const news = compStats.uudet.list.filter(inBand).map(l => l.eurM2);
            const rents = compStats.rent.filter(inBand).map(l => l.eurM2);
            const oldMed = median(olds), newMed = median(news), rentMed = median(rents);
            const priceForYield = newMed ?? yieldBase;
            return {
                id: b.id, oldMed, oldN: olds.length, newMed, newN: news.length,
                premium: oldMed && newMed ? newMed / oldMed - 1 : null,
                yield: rents.length >= 3 && rentMed && priceForYield ? (12 * rentMed) / priceForYield : null,
            };
        })
        : null;
    const oldP25 = pct(compStats?.vanhat.list.map(l => l.eurM2) ?? [], 0.25);
    const oldP75 = pct(compStats?.vanhat.list.map(l => l.eurM2) ?? [], 0.75);
    const roomCounts = compStats && compStats.vanhat.list.length > 0
        ? [1, 2, 3].map(r => compStats.vanhat.list.filter(l => l.rooms === r).length)
            .concat(compStats.vanhat.list.filter(l => (l.rooms ?? 0) >= 4).length)
        : null;

    const panel = (
        <div className="fixed right-0 top-0 h-full w-[400px] max-w-[94vw] bg-white shadow-2xl z-[1400] border-l border-slate-200 flex flex-col font-sans text-slate-900">
            {/* Header */}
            <div className="px-4 pt-3.5 pb-3 border-b border-slate-200 bg-slate-50/80">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-blue-600 mb-0.5">Markkina-analyysi</div>
                        <div className="text-[15px] font-bold leading-tight">
                            {area ? `${area.properties.name}` : 'Valittu piste'}
                            {area && <span className="text-slate-400 font-semibold"> · {area.properties.code}</span>}
                        </div>
                        <div className="text-[11px] text-slate-500">{area ? area.properties.kunta : `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`}</div>
                    </div>
                    <button onClick={onClose} className="p-1.5 bg-white rounded-full text-slate-400 hover:text-slate-700 border border-slate-200 shadow-sm flex-none" title="Sulje">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Kiinteistötunnus of the clicked parcel (MML) */}
                {parcel && (
                    <button
                        onClick={copyTunnus}
                        title={`${parcel.contained ? 'Kiinteistötunnus' : 'Lähin kiinteistö (piste ei osunut palstalle)'} — klikkaa kopioidaksesi`}
                        className="mt-2 inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 bg-white border border-slate-200 rounded-md hover:border-slate-300 shadow-sm transition-colors max-w-full"
                    >
                        <svg className="w-3 h-3 text-slate-400 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-13.2c0-1.12 0-1.68.218-2.11a2 2 0 01.874-.87C4.52 4.6 5.08 4.6 6.2 4.6h3.6c1.12 0 1.68 0 2.108.22a2 2 0 01.874.87c.218.43.218.99.218 2.11V21M3 21h18M13 21h8v-8.4c0-1.12 0-1.68-.218-2.11a2 2 0 00-.874-.87c-.428-.22-.988-.22-2.108-.22H13" />
                        </svg>
                        <span className="text-[10.5px] font-mono font-bold text-slate-700 tabular-nums truncate">
                            {!parcel.contained && '≈ '}{parcel.tunnus}
                        </span>
                        {parcel.yleinenAlue ? (
                            <span className="text-[10px] text-slate-400 flex-none">· katu/puisto</span>
                        ) : parcel.areaM2 != null && parcel.areaM2 > 0 && (
                            <span className="text-[10px] text-slate-400 flex-none">· {fmtArea(parcel.areaM2)}</span>
                        )}
                        <span className={`text-[9px] font-bold flex-none px-1 py-0.5 rounded ${copied ? 'text-green-700 bg-green-50' : 'text-slate-300'}`}>
                            {copied ? 'Kopioitu ✓' : (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            )}
                        </span>
                    </button>
                )}

                {/* Radius selector */}
                <div className="flex items-center gap-1.5 mt-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400 mr-1">Säde</span>
                    {[0.5, 1, 1.5, 2.5].map(r => (
                        <button
                            key={r}
                            onClick={() => onRadiusChange(r)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${radiusKm === r ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                        >
                            {String(r).replace('.', ',')} km
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* Area snippet — what kind of place this is */}
                {areaInfo && (
                    <div className="px-4 py-2.5 bg-blue-50/50 border-b border-slate-100">
                        <p className="text-[11px] leading-relaxed text-slate-600 border-l-2 border-blue-300 pl-2.5">{areaInfo}</p>
                    </div>
                )}

                {/* The answer, one view: verdict row → the four key numbers big →
                    what to build → signals → price ladder → sell-out estimate.
                    Detail sections below reveal how the numbers are derived. */}
                <div className="px-4 py-3.5 border-b border-slate-100 space-y-3">
                    {/* Verdict + key numbers */}
                    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white shadow-sm overflow-hidden">
                        <AnswerRow q="Myykö alue?" basis={areaVerdict?.basis}>
                            {areaVerdict
                                ? <span style={{ color: areaVerdict.color }}>
                                    {areaVerdict.label}
                                    {areaVerdict.source === 'vanha' && <span className="ml-1.5 text-[8.5px] font-bold uppercase tracking-wide text-slate-400 align-middle">vanhan kannan data</span>}
                                </span>
                                : marketLoading
                                    ? <span className="text-slate-300 animate-pulse">Haetaan…</span>
                                    : <span className="text-slate-300">Ei dataa</span>}
                        </AnswerRow>
                        {/* The four numbers that matter, presented big. Everything
                            else about how they arise lives in the sections below. */}
                        <div className="grid grid-cols-2 gap-px bg-slate-100">
                            <StatTile
                                label="Likvidi hinta"
                                title={liquidTitle}
                                note={liquidBand ? liquidNote : marketLoading ? 'haetaan…' : 'ei riittävää näyttöä'}
                            >
                                {liquidBand
                                    ? <>{fmtEur(liquidBand.lo)}–{fmtEur(liquidBand.hi)}<Unit>€/m²</Unit>{liquidBand.source === 'resale-premium' && EST_CHIP}</>
                                    : marketLoading
                                        ? <span className="text-slate-300 animate-pulse">…</span>
                                        : <span className="text-slate-300">–</span>}
                            </StatTile>
                            <StatTile
                                label="Uudisvuokra"
                                title={rentNew ? `Vuokrapyyntien mediaani ${rentNew.n} ilmoituksesta — ${rentNew.source}` : undefined}
                                note={rentNew ? `${rentNew.n} kpl · ${rentNew.source}` : compsLoading ? 'haetaan…' : 'ei vuokrailmoituksia'}
                            >
                                {rentNew
                                    ? <>{fmt1(rentNew.med)}<Unit>€/m²/kk</Unit>{rentNew.est && EST_CHIP}</>
                                    : compsLoading
                                        ? <span className="text-slate-300 animate-pulse">…</span>
                                        : <span className="text-slate-300">–</span>}
                            </StatTile>
                            <StatTile
                                label="Bruttotuotto uudis"
                                title="12 × uudisvuokra / kauppaava uudishinta (omistusvertailu)"
                                note={yieldNew != null ? 'uudisvuokra / kauppaava hinta' : 'vaatii vuokran ja hinnan'}
                            >
                                {yieldNew != null
                                    ? <span className={yieldNew >= 0.045 ? 'text-green-700' : undefined}>{fmt1(yieldNew * 100)}<Unit>%</Unit>{(rentNew?.est || omaEquivClearing?.est) && EST_CHIP}</span>
                                    : <span className="text-slate-300">–</span>}
                            </StatTile>
                            <StatTile
                                label="Tontin arvo"
                                title={PLOT_EXPLAIN}
                                note={plotOverride != null ? 'oma arvio · palauta kynästä' : plotEstimate ? plotEstimate.source : 'ei arviota — aseta kynästä'}
                                action={
                                    <button
                                        onClick={() => {
                                            if (!plotEditing) setPlotDraft(plotEstimate ? String(Math.round(plotEstimate.value)) : '');
                                            setPlotEditing(!plotEditing);
                                        }}
                                        className={`p-0.5 rounded transition-colors ${plotEditing ? 'text-slate-700 bg-slate-200' : 'text-slate-300 hover:text-slate-600'}`}
                                        title="Muokkaa tontin arvoa"
                                    >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
                                }
                            >
                                {plotEstimate
                                    ? <>{plotOverride == null && '≈ '}{fmtEur(plotEstimate.value)}<Unit>€/m²</Unit></>
                                    : <span className="text-slate-300">–</span>}
                            </StatTile>
                        </div>

                        {/* Plot-value editor: opens from the pencil, explains the
                            vuokratontti→oma conversion in one breath */}
                        {plotEditing && (
                            <div className="px-3 py-2 bg-slate-50/60">
                                <div className="flex items-center gap-1.5">
                                    <input
                                        type="number" min={0} max={5000} step={50} value={plotDraft} autoFocus
                                        onChange={e => setPlotDraft(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') savePlot(); if (e.key === 'Escape') setPlotEditing(false); }}
                                        placeholder="esim. 900"
                                        className="w-20 px-1.5 py-1 text-[12px] font-bold text-right border border-slate-200 rounded bg-white focus:outline-none focus:border-slate-400 tabular-nums"
                                    />
                                    <span className="text-[10px] text-slate-500 font-medium">€/asunto-m²</span>
                                    <button onClick={savePlot} className="ml-auto px-2.5 py-1 text-[10px] font-bold rounded bg-slate-900 text-white hover:bg-slate-700">OK</button>
                                    {plotOverride != null && plotAutoEstimate && (
                                        <button
                                            onClick={() => { setPlotOverride(null); setPlotEditing(false); }}
                                            className="px-2 py-1 text-[10px] font-bold rounded border border-slate-200 text-slate-600 hover:border-slate-300"
                                            title={`Palauta datasta laskettu arvio ${fmtEur(plotAutoEstimate.value)} €/m² (${plotAutoEstimate.source})`}
                                        >
                                            Palauta
                                        </button>
                                    )}
                                </div>
                                <div className="text-[9px] text-slate-400 mt-1.5 leading-relaxed">
                                    {PLOT_EXPLAIN} Arvo vaikuttaa likvidiin hintaan, hintaportaisiin (*), preemioon ja tuottoon.
                                </div>
                            </div>
                        )}
                        <AnswerRow
                            q="Mitä rakentaa"
                            basis={topProduct && !sthThin
                                ? `Nopein kierto + suurin kysyntä säteellä${topGap ? ` · huoneistovaje: ${topGap.type}` : ''}`
                                : infillBuild ? `${infillBuild.basis} — vanhan kannan signaali, ei uudisnäyttöä` : undefined}
                        >
                            {topProduct && !sthThin ? PRODUCT_SHORT[topProduct.class]
                                : infillBuild ? <>{infillBuild.label}<span className="ml-1 text-[9px] font-bold text-amber-600 align-middle">arvio</span></>
                                    : marketLoading ? <span className="text-slate-300 animate-pulse">Haetaan…</span>
                                        : <span className="text-slate-300">–</span>}
                        </AnswerRow>
                    </div>

                    {/* what the answers rest on */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-slate-400 font-medium -mt-1">
                        <span>Näyttö: {st.projects === 1 ? '1 uudiskohde' : `${st.projects} uudiskohdetta`} (STH)</span>
                        {comps && <span>{compStats?.sale.length ?? comps.sale.length} Oikotie-ilmoitusta</span>}
                        {resalePooled && <span>{resalePooled.sales12mo} toteutunutta kauppaa 12 kk (Tilastokeskus)</span>}
                    </div>

                    {/* Signals only — caveats, warnings, opportunities. The numbers
                        themselves already live in the answer card above. */}
                    {signals.length > 0 && (
                        <div className="space-y-1.5">
                            {signals.map((v, i) => (
                                <div key={i} className="flex items-start gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full flex-none mt-[5px]" style={{ background: TONE_COLOR[v.tone] }} />
                                    <span className="text-[11px] leading-snug text-slate-700">{v.text}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Price ladder */}
                    {ladder.length >= 2 && (
                        <div>
                            <div className="flex items-center justify-between gap-2">
                                <MicroLabel>{convertLease && !ladderUnconverted ? 'Hintaportaat (€/m², omistusvertailu)' : 'Hintaportaat (€/m²)'}</MicroLabel>
                                {ladderCanToggle && (
                                    <div className="flex rounded-full border border-slate-200 overflow-hidden flex-none" title="Näytetäänkö vuokratonttikohteiden hinnat tontin arvolla korotettuina (omistusvertailu) vai sellaisinaan">
                                        {([['oma', 'omistusvertailu'], ['raw', 'ilman tonttia']] as const).map(([id, label]) => (
                                            <button
                                                key={id}
                                                onClick={() => setLadderMode(id)}
                                                className={`px-1.5 py-0.5 text-[8.5px] font-bold transition-colors ${ladderMode === id ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:text-slate-700'}`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <PriceLadder points={ladder} />
                            <div className="text-[9px] text-slate-400 -mt-1 leading-relaxed">
                                Kauppaava = myyvien uudiskohteiden pyyntimediaani · Seisova = yli 24 kk varasto tai ei kauppoja.
                                {ladderHasRealized && <> Toteutunut = vanhojen KT-asuntojen toteutuneet kaupat.</>}
                                {ladderConverted && plotEstimate && <> * sisältää tontin arvon {fmtEur(plotEstimate.value)} €/m² ({plotEstimate.source}).</>}
                                {ladderUnconverted && <> (vt) = vuokratontti ilman tontin osuutta.</>}
                            </div>
                        </div>
                    )}

                    {/* Sell-out estimate */}
                    {topProduct && sellout != null && (
                        <div>
                            <div className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-2.5 py-2">
                                <span className="text-[10.5px] text-slate-600 flex items-center flex-wrap">
                                    Jos rakennat
                                    <input
                                        type="number" min={1} max={500} value={unitCount}
                                        onChange={e => setUnitCount(Math.min(500, Math.max(1, parseInt(e.target.value) || 1)))}
                                        className="w-12 mx-1.5 px-1 py-0.5 text-[11px] font-bold text-center border border-slate-200 rounded bg-white focus:outline-none focus:border-slate-400"
                                    />
                                    as. — myyntiaika
                                </span>
                                <span className="text-[13px] font-extrabold tabular-nums flex-none" style={{ color: miColor(sellout) }}>
                                    {sellout > 48 ? `≈ ${Math.round(sellout / 12)} v` : `≈ ${sellout} kk`}
                                </span>
                            </div>
                            <div className="text-[9px] text-slate-400 mt-1">
                                Karkea arvio: {PRODUCT_SHORT[topProduct.class].toLowerCase()}-kysyntä 12 kk jaettuna nykyisen tarjonnan ({topProduct.forSale} as.) ja kohteesi kesken.
                                {sthThin && (
                                    <b className="text-amber-600"> Ohut näyttö ({nKohdetta(st.projects)}) — tahti tulee säteen {PRODUCT_SHORT[topProduct.class].toLowerCase()}-kohteista{infillBuild && !infillBuild.label.startsWith(PRODUCT_SHORT[topProduct.class].split(' ')[0]) ? ', ei yllä suositellusta tuotteesta' : ''} — suuntaa-antava.</b>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Postal-area hotness, demoted to a chip — different frame than the radius */}
                    {hot != null && (
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            <span className="w-2 h-2 rounded-full flex-none" style={{ background: hotColor(hot) }} />
                            Postinumeroalueen kuumuus <b>{hot}/100</b>
                        </div>
                    )}
                    {areaStat?.lowConfidence && areaStat?.hotnessParts && (
                        <div className="text-[9.5px] text-amber-600 font-medium mt-2">⚠ Vähän kohteita postinumeroalueella — tulkitse pisteitä varoen</div>
                    )}
                    {areaStat?.hotnessParts && (
                        <div className="mt-2">
                            <button onClick={() => setShowScoreParts(!showScoreParts)} className="text-[10px] text-slate-400 hover:text-slate-600 font-semibold">
                                Pisteytyksen osatekijät {showScoreParts ? '▴' : '▾'}
                            </button>
                            {showScoreParts && (
                                <div className="space-y-1 mt-1.5">
                                    {[
                                        { label: 'Imu (varaston kesto)', v: areaStat.hotnessParts.imu },
                                        { label: 'Kysyntä (myynti 12 kk)', v: areaStat.hotnessParts.kysynta },
                                        { label: 'Momentum (6 kk)', v: areaStat.hotnessParts.momentum },
                                        { label: 'Hintavakaus', v: areaStat.hotnessParts.paine },
                                    ].map(row => (
                                        <div key={row.label} className="flex items-center gap-2">
                                            <span className="text-[9.5px] text-slate-500 w-[120px] flex-none leading-tight">{row.label}</span>
                                            <div className="flex-1 h-[5px] bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full rounded-full bg-slate-700" style={{ width: `${row.v}%` }} />
                                            </div>
                                            <span className="text-[9.5px] font-bold text-slate-600 w-6 text-right tabular-nums">{row.v}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* What to build — the evidence behind the "Rakenna" answer */}
                <Section title="Mitä tähän kannattaa rakentaa?" defaultOpen={false}>
                    {a.products.length === 0 ? (
                        <div className="text-[11.5px] text-slate-400">Ei vertailukohteita säteellä — laajenna sädettä.</div>
                    ) : (
                        <div className="space-y-1.5">
                            {(() => {
                                const top = a.products[0];
                                return (
                                    <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="text-[9px] font-bold uppercase tracking-[0.07em] text-green-700">Suositus</div>
                                                <div className="text-[13px] font-bold leading-tight truncate">{top.label}</div>
                                            </div>
                                            <MonthsChip mi={top.monthsInventory} />
                                        </div>
                                        <div className="text-[10.5px] text-slate-600 mt-1">
                                            {top.sold12} myyty 12 kk · {top.forSale} myynnissä
                                            {top.medEurM2Own != null && <> · oma tontti <b>{fmtEur(top.medEurM2Own)} €/m²</b></>}
                                            {top.medEurM2Lease != null && <> · vuokratontti <b>{fmtEur(top.medEurM2Lease)} €/m²</b></>}
                                        </div>
                                        {topGap && (
                                            <div className="text-[10.5px] font-semibold text-green-800 mt-1">
                                                Huoneistojakaumassa suurin vaje: {topGap.type}-asunnot
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                            {a.products.slice(1, 4).map((pr, i) => (
                                <div key={pr.class} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 bg-slate-50">
                                    <span className="w-5 h-5 rounded-full flex-none flex items-center justify-center text-[10px] font-extrabold bg-slate-200 text-slate-600">{i + 2}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[11.5px] font-bold truncate">{pr.label}</div>
                                        <div className="text-[10px] text-slate-500">
                                            {pr.sold12} myyty 12 kk · {pr.forSale} myynnissä
                                            {pr.medEurM2Own != null && <> · oma {fmtEur(pr.medEurM2Own)} €/m²</>}
                                            {pr.medEurM2Lease != null && <> · vuokra {fmtEur(pr.medEurM2Lease)} €/m²</>}
                                        </div>
                                    </div>
                                    <MonthsChip mi={pr.monthsInventory} />
                                </div>
                            ))}
                            <div className="text-[9.5px] text-slate-400 pt-0.5">Järjestys: kysyntä + varaston kiertonopeus säteellä. Kuukausiluku = myyntivaraston kesto.</div>
                        </div>
                    )}
                </Section>

                {/* Market situation in radius */}
                <Section title={`Markkinatilanne · ${String(radiusKm).replace('.', ',')} km`} defaultOpen={false} badge={<span className="text-[10px] text-slate-400 font-semibold">{nKohdetta(st.projects)}</span>}>
                    {st.projects === 0 ? (
                        <div className="text-[11.5px] text-slate-400">Ei STH-seurattuja uudiskohteita säteellä.</div>
                    ) : (
                        <>
                            <div className="grid grid-cols-4 gap-1.5 mb-2.5">
                                <div className="bg-slate-50 rounded-lg px-1.5 py-1.5 text-center">
                                    <div className="text-[12.5px] font-bold tabular-nums">{st.units.toFixed(0)}</div>
                                    <MicroLabel>Asuntoa</MicroLabel>
                                </div>
                                <div className="bg-slate-50 rounded-lg px-1.5 py-1.5 text-center">
                                    <div className="text-[12.5px] font-bold tabular-nums">{st.sold12.toFixed(0)}</div>
                                    <MicroLabel>Myyty 12 kk</MicroLabel>
                                </div>
                                <div className="bg-slate-50 rounded-lg px-1.5 py-1.5 text-center">
                                    <div className="text-[12.5px] font-bold tabular-nums" style={{ color: miColor(st.monthsInventory) }}>{formatMonthsInv(st.monthsInventory)}</div>
                                    <MicroLabel>Varasto kk</MicroLabel>
                                </div>
                                <div className="bg-slate-50 rounded-lg px-1.5 py-1.5 text-center">
                                    <div className="text-[12.5px] font-bold tabular-nums">{st.forSale.toFixed(0)}</div>
                                    <MicroLabel>Myynnissä</MicroLabel>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
                                {st.momentum != null && (
                                    <span>Momentum <b className={st.momentum >= 1 ? 'text-green-700' : 'text-red-700'}>
                                        {st.momentum >= 1 ? '▲' : '▼'} {Math.round(Math.abs(st.momentum - 1) * 100)} %
                                    </b></span>
                                )}
                                {st.hasDelta && <span>Kauppoja {formatSnapshot(dataset.prevSnapshot || 0)} jälkeen: <b>{st.deltaSold}</b></span>}
                                {st.cutShare > 0 && <span>Hinnanalennuksia <b>{Math.round(st.cutShare * 100)} %</b> kohteista</span>}
                            </div>
                        </>
                    )}
                </Section>

                {/* Reference buildings: the STH projects the numbers come from */}
                {a.nearby.length > 0 && (
                    <Section title="Vertailukohteet" defaultOpen={false} badge={<span className="text-[10px] text-slate-400 font-semibold">{a.nearby.length}</span>}>
                        <div className="space-y-1.5">
                            {a.nearby.slice(0, 20).map(({ project: p, distanceKm }) => {
                                const grade = gradeProject(p);
                                const tenureChip = p.tenure === 'oma'
                                    ? { label: 'oma', style: { background: '#d8e7fa', color: '#1e40af' } }
                                    : p.tenure === 'vuokra'
                                        ? { label: 'vuokra', style: { background: '#fdeec9', color: '#92400e' } }
                                        : { label: 'seka', style: { background: '#e2e8f0', color: '#475569' } };
                                return (
                                    <div key={p.key} className="rounded-lg bg-slate-50 px-2 py-1.5">
                                        <div className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full flex-none" style={{ background: grade.color }} title={grade.label} />
                                            <span className="text-[11px] font-bold truncate flex-1">{p.name.replace(/^As\.?\s?Oy\s?(Helsingin|Espoon|Vantaan)?\s?/i, '')}</span>
                                            {p.eurM2 > 0 && <span className="text-[11px] font-bold tabular-nums flex-none">{fmtEur(p.eurM2)} €/m²</span>}
                                            <span className="text-[8.5px] font-bold px-1 py-px rounded flex-none" style={tenureChip.style}>{tenureChip.label}</span>
                                        </div>
                                        <div className="text-[9.5px] text-slate-500 mt-0.5 pl-3.5 truncate">
                                            {p.builder && p.builder !== 'Ei ole tiedossa' ? `${p.builder} · ` : ''}
                                            {fmtKm(distanceKm)}
                                            {/* flag projects from another postal area — a different micro-market */}
                                            {area && p.postalCode && p.postalCode !== area.properties.code && (
                                                <span className="text-amber-600 font-semibold"> · {p.district || p.postalCode}</span>
                                            )}
                                            {' · '}{p.completed ? 'valmis' : `valm. ${formatYm(p.completionYm)}`} · myyty {p.sold.toFixed(0)}/{p.units.toFixed(0)}
                                            {p.sold12 > 0 ? ` · 12 kk: ${p.sold12.toFixed(0)}` : ''}
                                        </div>
                                    </div>
                                );
                            })}
                            {a.nearby.length > 20 && <div className="text-[10px] text-slate-400">+ {a.nearby.length - 20} muuta säteellä</div>}
                            <div className="text-[9.5px] text-slate-400 pt-0.5">
                                Analyysin luvut lasketaan näistä kohteista. Kytke Uudiskohteet (STH) -taso nähdäksesi ne kartalla.
                            </div>
                        </div>
                    </Section>
                )}

                {/* Movers vs stalled: what separates stock that sells from stock that sits */}
                {cmp && (
                    <Section
                        title="Miksi jotkin kohteet myyvät?"
                        defaultOpen={false}
                        badge={cmp.inverted
                            ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">hinta ei selitä</span>
                            : <span className="text-[10px] text-slate-400 font-semibold">{cmp.movers.length} myy · {cmp.stalled.length} seisoo</span>}
                    >
                        <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-1.5">
                                <div className="rounded-lg bg-green-50 border border-green-100 px-2 py-1.5">
                                    <div className="text-[9px] font-bold uppercase tracking-[0.07em] text-green-700">Myyvät ({cmp.movers.length})</div>
                                    <div className="text-[10.5px] text-slate-700 mt-0.5 leading-snug">
                                        {cmp.m.medEurM2Own != null && <div>oma tontti <b className="tabular-nums">{fmtEur(cmp.m.medEurM2Own)} €/m²</b></div>}
                                        {cmp.m.medEurM2Lease != null && <div>vuokratontti <b className="tabular-nums">{fmtEur(cmp.m.medEurM2Lease)} €/m²</b></div>}
                                        {cmp.m.medAvgSize != null && <div>asunnot ka. <b>{Math.round(cmp.m.medAvgSize)} m²</b>{cmp.m.medUnits != null && <> · md {Math.round(cmp.m.medUnits)} as./kohde</>}</div>}
                                    </div>
                                </div>
                                <div className="rounded-lg bg-red-50 border border-red-100 px-2 py-1.5">
                                    <div className="text-[9px] font-bold uppercase tracking-[0.07em] text-red-700">Seisovat ({cmp.stalled.length})</div>
                                    <div className="text-[10.5px] text-slate-700 mt-0.5 leading-snug">
                                        {cmp.s.medEurM2Own != null && <div>oma tontti <b className="tabular-nums">{fmtEur(cmp.s.medEurM2Own)} €/m²</b></div>}
                                        {cmp.s.medEurM2Lease != null && <div>vuokratontti <b className="tabular-nums">{fmtEur(cmp.s.medEurM2Lease)} €/m²</b></div>}
                                        {cmp.s.medAvgSize != null && <div>asunnot ka. <b>{Math.round(cmp.s.medAvgSize)} m²</b>{cmp.s.medUnits != null && <> · md {Math.round(cmp.s.medUnits)} as./kohde</>}</div>}
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-1">
                                {cmp.reasons.map((r, i) => (
                                    <div key={i} className="flex items-start gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full flex-none mt-[5px] bg-slate-400" />
                                        <span className="text-[10.5px] leading-snug text-slate-700">{r}</span>
                                    </div>
                                ))}
                                {cmp.reasons.length === 0 && (
                                    <div className="text-[10.5px] text-slate-400">
                                        Ryhmät ovat liian pieniä tai samankaltaisia selkeään erittelyyn{scatterEligible(radiusProjects).length >= 3 ? ' — katso hajontakuva' : ''}.
                                    </div>
                                )}
                            </div>
                            {scatterEligible(radiusProjects).length >= 3 && (
                                <div>
                                    <MicroLabel>Hinta vs. kiertonopeus — jokainen piste on kohde</MicroLabel>
                                    <AbsorptionScatter projects={radiusProjects} />
                                    <div className="text-[9px] text-slate-400 leading-relaxed mt-0.5">
                                        Täytetty piste = oma tai sekamuotoinen tontti · rengas = vuokratontti (hinta ilman tonttia) ·
                                        koko = asuntomäärä · väri = menekkiluokka. Napauta pistettä nähdäksesi kohteen. Alas = hitaampi kierto.
                                    </div>
                                </div>
                            )}
                        </div>
                    </Section>
                )}

                {/* Price level — the evidence behind the ladder */}
                <Section title="Hintataso" defaultOpen={false}>
                    <div className="space-y-1.5">
                        {/* owned-plot and leasehold prices are separate markets — never pooled */}
                        {a.clearingPrice.oma && (
                            <div className="flex items-baseline justify-between">
                                <span className="text-[11.5px] text-slate-600">Kauppaava uudishinta · <b>oma tontti</b> <span className="text-slate-400">({a.clearingPrice.oma.n} kohd.)</span></span>
                                <span className="text-[13px] font-bold text-green-700 tabular-nums">{fmtEur(a.clearingPrice.oma.value)} €/m²</span>
                            </div>
                        )}
                        {a.clearingPrice.vuokra && (
                            <div className="flex items-baseline justify-between">
                                <span className="text-[11.5px] text-slate-600">Kauppaava · <b>vuokratontti</b> <span className="text-slate-400">({a.clearingPrice.vuokra.n} kohd., ilman tonttia)</span></span>
                                <span className="text-[13px] font-bold text-green-700 tabular-nums">{fmtEur(a.clearingPrice.vuokra.value)} €/m²</span>
                            </div>
                        )}
                        {a.stalledPrice.oma && (
                            <div className="flex items-baseline justify-between">
                                <span className="text-[11.5px] text-slate-600">Seisova pyynti · oma tontti <span className="text-slate-400">({a.stalledPrice.oma.n} kohd.)</span></span>
                                <span className="text-[13px] font-bold text-red-600 tabular-nums">{fmtEur(a.stalledPrice.oma.value)} €/m²</span>
                            </div>
                        )}
                        {a.stalledPrice.vuokra && (
                            <div className="flex items-baseline justify-between">
                                <span className="text-[11.5px] text-slate-600">Seisova pyynti · vuokratontti <span className="text-slate-400">({a.stalledPrice.vuokra.n} kohd.)</span></span>
                                <span className="text-[13px] font-bold text-red-600 tabular-nums">{fmtEur(a.stalledPrice.vuokra.value)} €/m²</span>
                            </div>
                        )}
                        {!hasClearing && !hasStalled && <div className="text-[11.5px] text-slate-400">Ei riittävästi uudiskohteita hinta-arvioon.</div>}
                        {(hasClearing || hasStalled) && (
                            <div className="text-[9px] text-slate-400">
                                Kauppaava ja seisova ovat eri kohteita — hyvä tuote voi pyytää enemmän ja silti myydä.
                            </div>
                        )}
                        {plotEstimate && (a.clearingPrice.vuokra || a.stalledPrice.vuokra) && (
                            <div className="text-[10px] text-slate-500 bg-slate-50 rounded px-1.5 py-1">
                                Tontin arvo <b>{fmtEur(plotEstimate.value)} €/m²</b> ({plotEstimate.source})
                                {a.clearingPrice.vuokra && <> → kauppaava vt omistusvertailuna ≈ <b>{fmtEur(a.clearingPrice.vuokra.value + plotEstimate.value)} €/m²</b></>}
                            </div>
                        )}

                        {(compsLoading || compsError || compStats) && (
                            <>
                                <div className="border-t border-slate-100 my-1.5" />
                                <MicroLabel>Oikotie · myynnissä nyt (€/m², mediaani)</MicroLabel>
                            </>
                        )}
                        {compsLoading && <div className="text-[11px] text-slate-400 py-1">Haetaan Oikotiestä…</div>}
                        {compsError && <div className="text-[11px] text-red-500 py-1">Oikotie-haku epäonnistui — yritä hetken päästä uudelleen.</div>}
                        {compStats && (
                            <div className="grid grid-cols-3 gap-1.5 mt-1">
                                {[
                                    { label: 'Uudet', d: compStats.uudet },
                                    { label: '2010-luku', d: compStats.uudehkot },
                                    { label: 'Vanhat', d: compStats.vanhat },
                                ].map(b => (
                                    <div key={b.label} className="bg-slate-50 rounded-lg px-1.5 py-1.5 text-center">
                                        <div className="text-[12px] font-bold tabular-nums">{b.d.med ? fmtEur(b.d.med) : '–'}</div>
                                        <MicroLabel>{b.label} ({b.d.n})</MicroLabel>
                                    </div>
                                ))}
                            </div>
                        )}
                        {premium != null && (
                            <div className={`text-[11px] mt-1 ${premium > 0.55 ? 'text-red-600' : 'text-slate-600'}`}>
                                Uudishinnan preemio vanhaan kantaan <span className="text-slate-400">({omaEquivClearing?.est ? 'omistusvertailu' : 'oma tontti'}, vs. {premiumVsRealized ? 'toteutuneet' : 'pyynnit'})</span>: <b>{premium >= 0 ? '+' : ''}{Math.round(premium * 100)} %</b>
                                {premium > 0.55 && ' — korkea preemio hidastaa myyntiä'}
                            </div>
                        )}
                        {compStats && compStats.rentAll.n > 0 && (
                            <>
                                <div className="border-t border-slate-100 my-1.5" />
                                <MicroLabel>Vuokrataso · pyynnit (€/m²/kk, mediaani · {compStats.rentAll.n} ilmoitusta)</MicroLabel>
                                <div className="grid grid-cols-3 gap-1.5 mt-1">
                                    {[
                                        { label: 'Uudet', d: compStats.rentUudet },
                                        { label: '2010-luku', d: compStats.rent2010s },
                                        { label: 'Vanhat', d: compStats.rentOld },
                                    ].map(b => (
                                        <div key={b.label} className="bg-slate-50 rounded-lg px-1.5 py-1.5 text-center">
                                            <div className="text-[12px] font-bold tabular-nums">{b.d.med ? fmt1(b.d.med) : '–'}</div>
                                            <MicroLabel>{b.label} ({b.d.n})</MicroLabel>
                                        </div>
                                    ))}
                                </div>
                                <div className="text-[9px] text-slate-400 mt-0.5">
                                    Uudet = valmistunut {new Date().getFullYear() - 5}– tai uudiskohde. Uudisvuokra-lukuun käytetään näitä; jos säteellä on liian vähän, taso haetaan koko postinumerojoukosta tai 2010-luvun kannasta (merkitty arvioksi).
                                </div>
                                {(yieldOld != null || yieldNew != null) && (
                                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-600 mt-1">
                                        {yieldNew != null && <span>Bruttotuotto uudet: <b className={yieldNew >= 0.045 ? 'text-green-700' : undefined}>{fmt1(yieldNew * 100)} %</b></span>}
                                        {yieldOld != null && <span>vanhat: <b>{fmt1(yieldOld * 100)} %</b></span>}
                                    </div>
                                )}
                            </>
                        )}
                        {/* Size-band pricing: where the market pays the new-build premium */}
                        {bandStats && bandStats.some(b => b.oldMed != null || b.newMed != null) && (
                            <>
                                <div className="border-t border-slate-100 my-1.5" />
                                <MicroLabel>Hinta kokoluokittain (€/m², mediaani)</MicroLabel>
                                <div className="mt-1 space-y-0.5">
                                    <div className="grid grid-cols-[42px_1fr_1fr_50px_44px] gap-1 text-[8.5px] font-bold uppercase tracking-wide text-slate-400">
                                        <span>m²</span>
                                        <span className="text-right">Vanhat</span>
                                        <span className="text-right">Uudet</span>
                                        <span className="text-right">Preemio</span>
                                        <span className="text-right">Tuotto</span>
                                    </div>
                                    {bandStats.map(b => (
                                        <div key={b.id} className="grid grid-cols-[42px_1fr_1fr_50px_44px] gap-1 text-[10.5px] tabular-nums items-baseline">
                                            <span className="font-bold text-slate-600">{b.id}</span>
                                            <span className="text-right">{b.oldMed != null ? <>{fmtEur(b.oldMed)}<span className="text-slate-300 text-[8px]"> {b.oldN}</span></> : <span className="text-slate-300">–</span>}</span>
                                            <span className="text-right">{b.newMed != null ? <>{fmtEur(b.newMed)}<span className="text-slate-300 text-[8px]"> {b.newN}</span></> : <span className="text-slate-300">–</span>}</span>
                                            <span className={`text-right font-bold ${b.premium != null && b.premium > 0.55 ? 'text-red-600' : 'text-slate-600'}`}>
                                                {b.premium != null ? `${b.premium >= 0 ? '+' : ''}${Math.round(b.premium * 100)} %` : '–'}
                                            </span>
                                            <span className={`text-right font-bold ${b.yield != null && b.yield >= 0.045 ? 'text-green-700' : 'text-slate-500'}`}>
                                                {b.yield != null ? `${(b.yield * 100).toFixed(1).replace('.', ',')} %` : '–'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="text-[9px] text-slate-400 mt-0.5">
                                    Tuotto = bruttotuotto uudishintaan alueen vuokrapyynnöistä — vihreä ≥ 4,5 % vetää sijoittajia.
                                </div>
                                {oldP25 != null && oldP75 != null && (
                                    <div className="text-[10px] text-slate-500 mt-1">
                                        Vanhan kannan hajonta: <b>{fmtEur(oldP25)}–{fmtEur(oldP75)} €/m²</b> <span className="text-slate-400">(p25–p75{oldP75 / oldP25 > 1.45 ? ' — laaja: sijainti ja kunto ratkaisevat' : ''})</span>
                                    </div>
                                )}
                            </>
                        )}
                        {compStats && compStats.sale.length > 0 && (
                            <>
                                <button onClick={() => setShowListings(!showListings)} className="text-[10.5px] text-blue-600 hover:underline font-semibold mt-1">
                                    {showListings ? 'Piilota ilmoitukset' : `Selaa Oikotie-ilmoituksia (${compStats.sale.length})`}
                                </button>
                                {showListings && (
                                    <>
                                        <div className="flex gap-1 mt-1.5">
                                            {([
                                                { id: 'vanhat' as const, label: 'Vanhat' },
                                                { id: 'uudehkot' as const, label: '2010-luku' },
                                                { id: 'uudet' as const, label: 'Uudet' },
                                            ]).map(b => (
                                                <button
                                                    key={b.id}
                                                    onClick={() => setListingBucket(b.id)}
                                                    className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-all ${listingBucket === b.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                                                >
                                                    {b.label} ({compStats[b.id].n})
                                                </button>
                                            ))}
                                        </div>
                                        <div className="space-y-1 mt-1.5">
                                            {bucketListings.length === 0 && <div className="text-[10.5px] text-slate-400">Ei ilmoituksia tässä ryhmässä.</div>}
                                            {bucketListings.slice(0, 12).map(l => {
                                                const d = listingDist(l);
                                                return (
                                                    <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"
                                                        className="flex items-baseline justify-between gap-2 text-[10.5px] hover:bg-slate-50 rounded px-1 py-0.5 -mx-1">
                                                        <span className="truncate text-slate-700">
                                                            {l.address || l.district}
                                                            <span className="text-slate-400"> · {l.year || '–'} · {l.sizeM2} m²{l.roomConfig ? ` · ${l.roomConfig}` : ''}{d != null ? ` · ${fmtKm(d)}` : ''}</span>
                                                            {l.daysOnMarket != null && (
                                                                <span className={l.daysOnMarket > 90 ? 'text-red-500' : 'text-slate-400'}> · {l.daysOnMarket} vrk</span>
                                                            )}
                                                            {l.priceCut && <span className="text-amber-600 font-semibold"> ↓hinta</span>}
                                                        </span>
                                                        <span className="font-bold tabular-nums flex-none">{fmtEur(l.eurM2)} €/m²</span>
                                                    </a>
                                                );
                                            })}
                                            {bucketListings.length > 12 && <div className="text-[10px] text-slate-400">+ {bucketListings.length - 12} muuta ilmoitusta</div>}
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </Section>

                {/* Resale market: realized sales (Tilastokeskus) + listing liquidity (Oikotie).
                    In infill areas with little new construction this is the primary evidence. */}
                {(resalePooled || (resaleLiq && resaleLiq.n > 0)) && (
                    <Section
                        title="Vanha kanta & likviditeetti"
                        defaultOpen={sthThin}
                        badge={resaleGrade
                            ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: LIQUIDITY_COLOR[resaleGrade] }}>{LIQUIDITY_LABEL[resaleGrade]}</span>
                            : undefined}
                    >
                        <div className="space-y-2">
                            <div className="grid grid-cols-4 gap-1.5">
                                <div className="bg-slate-50 rounded-lg px-1 py-1.5 text-center">
                                    <div className="text-[12.5px] font-bold tabular-nums">{resalePooled ? resalePooled.sales12mo : '–'}</div>
                                    <MicroLabel>Kauppaa 12 kk</MicroLabel>
                                </div>
                                <div className="bg-slate-50 rounded-lg px-1 py-1.5 text-center">
                                    <div className="text-[12.5px] font-bold tabular-nums" style={{ color: resaleLiq?.monthsInventory != null ? miColor(resaleLiq.monthsInventory) : undefined }}>
                                        {resaleLiq?.monthsInventory != null ? formatMonthsInv(resaleLiq.monthsInventory) : '–'}
                                    </div>
                                    <MicroLabel>Varasto kk (KT)</MicroLabel>
                                </div>
                                <div className="bg-slate-50 rounded-lg px-1 py-1.5 text-center">
                                    <div className="text-[12.5px] font-bold tabular-nums">{resaleLiq?.domMedian != null ? Math.round(resaleLiq.domMedian) : '–'}</div>
                                    <MicroLabel>Ilm. ikä md vrk</MicroLabel>
                                </div>
                                <div className="bg-slate-50 rounded-lg px-1 py-1.5 text-center">
                                    <div className="text-[12.5px] font-bold tabular-nums">{resalePooled?.ktEurM2 != null ? fmtEur(resalePooled.ktEurM2) : '–'}</div>
                                    <MicroLabel>Tot. KT €/m²</MicroLabel>
                                </div>
                            </div>

                            {resalePooled && resalePooled.quarters.some(q => q.count > 0) && (
                                <div>
                                    <MicroLabel>Toteutuneet kaupat / neljännes (Tilastokeskus)</MicroLabel>
                                    <QuarterBars quarters={resalePooled.quarters} />
                                    <div className="text-[9px] text-slate-400 -mt-1">* uusin neljännes on ennakkotieto ja täydentyy vielä</div>
                                </div>
                            )}

                            {resalePooled && resalePooled.prices.length > 0 && (
                                <div className="space-y-0.5">
                                    <MicroLabel>Toteutuneet hinnat tyypeittäin (Tilastokeskus)</MicroLabel>
                                    {resalePooled.prices.map(p => (
                                        <div key={p.id} className="flex items-baseline justify-between text-[11px]">
                                            <span className="text-slate-500 font-medium">
                                                {p.label} <span className="text-slate-300">({p.n} kauppaa)</span>
                                                {p.source === 'annual' && <span className="text-[8.5px] font-bold text-amber-600 ml-1">vuositaso</span>}
                                            </span>
                                            <span className="font-bold tabular-nums">{fmtEur(p.eurM2)} €/m²</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {(askVsRealized != null || resalePooled?.trendPct != null || resaleLiq?.turnoverPct != null) && (
                                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10.5px] text-slate-600">
                                    {askVsRealized != null && (
                                        <span>Pyynnit vs. toteutuneet <b className={askVsRealized > 0.15 ? 'text-red-600' : 'text-slate-700'}>{askVsRealized >= 0 ? '+' : ''}{Math.round(askVsRealized * 100)} %</b></span>
                                    )}
                                    {resalePooled?.trendPct != null && (
                                        <span>Hinta 12 kk <b className={resalePooled.trendPct >= 0 ? 'text-green-700' : 'text-red-600'}>{resalePooled.trendPct >= 0 ? '+' : ''}{resalePooled.trendPct.toFixed(1).replace('.', ',')} %</b></span>
                                    )}
                                    {resaleLiq?.turnoverPct != null && (
                                        <span>Kierto <b>{resaleLiq.turnoverPct.toFixed(1).replace('.', ',')} %</b> KT-kannasta/v</span>
                                    )}
                                </div>
                            )}

                            {resaleLiq && resaleLiq.n >= 5 && (
                                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10.5px] text-slate-600">
                                    {resaleLiq.staleShare != null && <span>Yli 90 vrk myynnissä <b>{Math.round(resaleLiq.staleShare * 100)} %</b></span>}
                                    {resaleLiq.cutShare != null && <span>Hintaa laskettu <b>{Math.round(resaleLiq.cutShare * 100)} %</b></span>}
                                    {resaleLiq.bumpedShare != null && <span>Ilmoitus uusittu <b>{Math.round(resaleLiq.bumpedShare * 100)} %</b></span>}
                                </div>
                            )}

                            {sizeBandsLiq && sizeBandsLiq.some(b => b.domMedian != null) && (
                                <div>
                                    <MicroLabel>Mikä koko liikkuu? (myynnissä olevien ilmoitusten ikä)</MicroLabel>
                                    <div className="mt-1 space-y-0.5">
                                        <div className="grid grid-cols-[46px_1fr_1fr_1fr] gap-1 text-[8.5px] font-bold uppercase tracking-wide text-slate-400">
                                            <span>m²</span>
                                            <span className="text-right">Ilmoituksia</span>
                                            <span className="text-right">Ilm. ikä md</span>
                                            <span className="text-right">Hintaa laskettu</span>
                                        </div>
                                        {sizeBandsLiq.map(b => {
                                            const fastest = fastestBand?.id === b.id && b.domMedian != null;
                                            return (
                                                <div key={b.id} className={`grid grid-cols-[46px_1fr_1fr_1fr] gap-1 text-[10.5px] tabular-nums items-baseline ${fastest ? 'font-bold text-green-700' : ''}`}>
                                                    <span className="font-bold text-slate-600">{b.id}{fastest ? ' ★' : ''}</span>
                                                    <span className="text-right">{b.n || '–'}</span>
                                                    <span className="text-right">{b.domMedian != null ? `${Math.round(b.domMedian)} vrk` : '–'}</span>
                                                    <span className="text-right">{b.cutShare != null ? `${Math.round(b.cutShare * 100)} %` : '–'}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="text-[9px] text-slate-400 leading-relaxed">
                                Toteutuneet kaupat, varasto ja kierto lasketaan postinumeroalueittain ({resalePooled?.postcodes.join(', ') || comps?.postcodes.join(', ')}), ei säteellä —
                                varainsiirtoverotiedot tilastoidaan postinumerotasolla. Varasto ja kierto ovat kerrostalokannan (KT) lukuja, jotta
                                osoittaja ja nimittäjä mittaavat samaa kantaa. Ilm. ikä = kuinka kauan nykyiset myynti-ilmoitukset ovat olleet
                                ulkona (Oikotie) — ei toteutunut myyntiaika.
                            </div>
                        </div>
                    </Section>
                )}

                {/* Unit mix gap */}
                {st.projects > 0 && (
                    <Section title="Huoneistojakauman vaje" defaultOpen={false}>
                        <div className="space-y-1.5">
                            {a.mixGap.filter(m => m.sold + m.unsold > 0).map(m => (
                                <div key={m.type} className="flex items-center gap-2">
                                    <span className="w-8 text-[10.5px] font-bold text-slate-600">{m.type}</span>
                                    <div className="flex-1 space-y-[3px]">
                                        <div className="h-[7px] bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500" style={{ width: `${100 * m.soldShare}%` }} />
                                        </div>
                                        <div className="h-[7px] bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-orange-400" style={{ width: `${100 * m.unsoldShare}%` }} />
                                        </div>
                                    </div>
                                    <span className={`w-16 text-right text-[10px] font-bold ${m.gap > 0.05 ? 'text-green-700' : m.gap < -0.05 ? 'text-red-600' : 'text-slate-400'}`}>
                                        {m.gap > 0.05 ? '▲ vajaus' : m.gap < -0.05 ? '▼ ylitarj.' : 'tasapaino'}
                                    </span>
                                </div>
                            ))}
                            <div className="flex gap-3 pt-0.5 text-[9.5px] text-slate-400">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Osuus myydyistä</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" /> Osuus myymättömistä</span>
                            </div>
                            {roomCounts && (
                                <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100 mt-1.5">
                                    Vanhaa kantaa myynnissä (Oikotie): 1H <b>{roomCounts[0]}</b> · 2H <b>{roomCounts[1]}</b> · 3H <b>{roomCounts[2]}</b> · 4H+ <b>{roomCounts[3]}</b>
                                    {' '}— vähäinen tarjonta vahvistaa vajesignaalin.
                                </div>
                            )}
                        </div>
                    </Section>
                )}

                {/* Competitors */}
                {a.builders.length > 0 && (
                    <Section title="Rakentajat alueella" defaultOpen={false} badge={<span className="text-[10px] text-slate-400 font-semibold">{a.builders.length}</span>}>
                        <div className="space-y-1">
                            {a.builders.slice(0, 8).map(b => (
                                <div key={b.name} className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="truncate font-semibold text-slate-700">{b.name}</span>
                                    <span className="flex-none text-slate-500 tabular-nums">
                                        {b.projects} kohd. · {b.sold12} myyty/12 kk · <MonthsChip mi={b.monthsInventory} />
                                    </span>
                                </div>
                            ))}
                        </div>
                    </Section>
                )}

                {/* Pipeline */}
                <Section title="Tuleva tarjonta" defaultOpen={false} badge={
                    <span className="text-[10px] text-slate-400 font-semibold">{nKohdetta(a.pipeline.length)}{plansNearby ? ` · ${plansNearby} kaavaa` : ''}</span>
                }>
                    {a.pipeline.length === 0 ? (
                        <div className="text-[11.5px] text-slate-400">Ei rakenteilla/tulossa olevia STH-kohteita säteellä.</div>
                    ) : (
                        <div className="space-y-1">
                            {a.pipeline.slice(0, 8).map(({ project: p, distanceKm }) => (
                                <div key={p.key} className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="truncate">
                                        <b>{formatYm(p.completionYm)}</b> · {p.name.replace(/^As\.?\s?Oy\s?(Helsingin|Espoon|Vantaan)?\s?/i, '')}
                                    </span>
                                    <span className="flex-none text-slate-500 tabular-nums">{p.forSale.toFixed(0)} as. · {fmtKm(distanceKm)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {plansNearby != null && plansNearby > 0 && (
                        <div className="text-[10.5px] text-purple-700 font-medium mt-1.5">
                            + {plansNearby} vireillä olevaa asemakaavaa säteellä (Helsinki) — mahdollista tulevaa tarjontaa
                        </div>
                    )}
                </Section>

                {/* Demographics */}
                {area && (
                    <Section title="Alue & asukkaat (Paavo)" defaultOpen={false}>
                        {(() => {
                            const ap = area.properties;
                            const rows = [
                                { label: 'Asukkaita', value: ap.pop != null ? ap.pop.toLocaleString('fi-FI') : '–' },
                                { label: 'Talouksien mediaanitulot', value: ap.hhMedIncome != null ? `${fmtEur(ap.hhMedIncome)} €/v` : '–' },
                                { label: 'Lapsiperheitä', value: ap.familyShare != null ? `${Math.round(ap.familyShare * 100)} %` : '–' },
                                { label: '25–39-vuotiaita', value: ap.youngAdultShare != null ? `${Math.round(ap.youngAdultShare * 100)} %` : '–' },
                                { label: 'Omistusasujia', value: ap.ownerShare != null ? `${Math.round(ap.ownerShare * 100)} %` : '–' },
                                { label: 'Kerrostaloasuntoja', value: ap.ktShare != null ? `${Math.round(ap.ktShare * 100)} %` : '–' },
                                { label: 'Asunnon keskikoko', value: ap.avgDwellingM2 != null ? `${Math.round(ap.avgDwellingM2)} m²` : '–' },
                            ];
                            return (
                                <div className="space-y-1">
                                    {rows.map(r => (
                                        <div key={r.label} className="flex items-baseline justify-between text-[11.5px]">
                                            <span className="text-slate-400 font-medium">{r.label}</span>
                                            <span className="font-semibold tabular-nums">{r.value}</span>
                                        </div>
                                    ))}
                                    <div className="text-[9px] text-slate-300 pt-0.5">Tilastokeskus Paavo {area.properties.year || ''}</div>
                                </div>
                            );
                        })()}
                    </Section>
                )}

                {/* Access */}
                <Section title="Saavutettavuus" defaultOpen={false}>
                    <div className="space-y-1 text-[11.5px]">
                        {access?.nearest ? (
                            <div className="flex items-baseline justify-between">
                                <span className="text-slate-400 font-medium">{RAIL_TYPE_LABELS[access.nearest.station.type]} · {access.nearest.station.name}</span>
                                <span className={`font-bold tabular-nums ${access.nearest.distanceKm <= 0.8 ? 'text-green-700' : access.nearest.distanceKm <= 1.5 ? 'text-slate-700' : 'text-red-600'}`}>
                                    {fmtKm(access.nearest.distanceKm)}
                                </span>
                            </div>
                        ) : <div className="text-slate-400">Raideyhteydet: ei dataa</div>}
                        {access?.nearestPlanned && access.nearestPlanned.distanceKm < (access.nearest?.distanceKm ?? 99) && (
                            <div className="flex items-baseline justify-between text-purple-700">
                                <span className="font-medium">Rakenteilla: {access.nearestPlanned.station.name}</span>
                                <span className="font-bold tabular-nums">{fmtKm(access.nearestPlanned.distanceKm)}</span>
                            </div>
                        )}
                        {amen && (
                            <>
                                <div className="flex items-baseline justify-between">
                                    <span className="text-slate-400 font-medium">Koulut / päiväkodit 1 km</span>
                                    <span className="font-semibold tabular-nums">{amen.koulu} / {amen.paivakoti}</span>
                                </div>
                                <div className="flex items-baseline justify-between">
                                    <span className="text-slate-400 font-medium">Lähin ruokakauppa</span>
                                    <span className="font-semibold tabular-nums">{fmtKm(amen.nearestKauppa)}</span>
                                </div>
                            </>
                        )}
                    </div>
                </Section>

                {/* Footer */}
                <div className="px-4 py-3 text-[9px] text-slate-400 leading-relaxed">
                    STH-Group {formatSnapshot(dataset.snapshot)}{dataset.prevSnapshot ? ` (vertailu ${formatSnapshot(dataset.prevSnapshot)})` : ''} ·
                    Oikotie {comps ? new Date(comps.fetchedAt).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' }) : '–'} ·
                    Tilastokeskus (Paavo, toteutuneet kaupat) · Maanmittauslaitos · OSM · Helsingin kaupunki
                </div>
            </div>
        </div>
    );

    return createPortal(panel, document.body);
}
