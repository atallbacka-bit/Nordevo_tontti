"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    SthDataset, AreaStats, analyzePoint, formatMonthsInv,
    formatSnapshot, formatYm, fmtEur, haversineKm, gradeProject,
} from '@/lib/sthAnalysis';
import {
    loadPostalAreas, loadRailStations, loadAmenities,
    findPostalArea, nearbyPostalCodes, railAccess, amenityCounts, fmtKm,
    PostalAreaFC, RailStation, Amenity, ParcelInfo, RAIL_TYPE_LABELS,
} from '@/lib/marketData';
import { POSTAL_INFO } from '@/lib/postalInfo';

// One-stop market analysis for a clicked point (or postal area) on the map.
// Layout is verdict-first: the header carries identity (area, kiinteistötunnus),
// then a written area snippet, then an auto-generated plain-language verdict
// next to the hotness score. Detail sections follow, most collapsed.

interface CompListing {
    id: number; url: string; address: string; district: string;
    year: number | null; newDev: boolean; rooms: number | null; roomConfig: string;
    sizeM2: number; price: number; eurM2: number;
    lat: number | null; lng: number | null; postcode: string;
}

interface CompsResponse { postcodes: string[]; sale: CompListing[]; rent: CompListing[]; fetchedAt: string; error?: string }

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
    const [showListings, setShowListings] = useState(false);
    const [showScoreParts, setShowScoreParts] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => { setMounted(true); }, []);
    useEffect(() => {
        loadPostalAreas().then(setPostalFC).catch(() => { });
        loadRailStations().then(setRail).catch(() => { });
        loadAmenities().then(setAmenities).catch(() => { });
    }, []);

    useEffect(() => { setCopied(false); }, [parcel?.tunnus]);

    // Oikotie comps for the surrounding postal codes
    useEffect(() => {
        if (!open || !point || !postalFC) return;
        const codes = nearbyPostalCodes(point.lat, point.lng, postalFC, Math.max(1.2, radiusKm), 4);
        if (!codes.length) { setComps(null); return; }
        let cancelled = false;
        setCompsLoading(true);
        setCompsError(false);
        fetch(`/api/market/comps?postcodes=${codes.join(',')}`)
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(d => { if (!cancelled) setComps(d); })
            .catch(() => { if (!cancelled) { setComps(null); setCompsError(true); } })
            .finally(() => { if (!cancelled) setCompsLoading(false); });
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
        const rentNewish = rent.filter(l => l.year != null && l.year >= 2010);
        return {
            sale, rent,
            uudet: { med: median(uudet.map(l => l.eurM2)), n: uudet.length },
            uudehkot: { med: median(uudehkot.map(l => l.eurM2)), n: uudehkot.length },
            vanhat: { med: median(vanhat.map(l => l.eurM2)), n: vanhat.length },
            rentAll: { med: median(rent.map(l => l.eurM2)), n: rent.length },
            rentNewish: { med: median(rentNewish.map(l => l.eurM2)), n: rentNewish.length },
        };
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
    // premium & yield use owned-plot clearing price only — leasehold €/m²
    // excludes the land and would understate both
    const clearingOma = a.clearingPrice.oma;
    const yieldOld = compStats?.rentAll.med && compStats?.vanhat.med ? (12 * compStats.rentAll.med) / compStats.vanhat.med : null;
    const yieldNew = compStats?.rentNewish.med && clearingOma ? (12 * compStats.rentNewish.med) / clearingOma.value : null;
    const premium = clearingOma && compStats?.vanhat.med ? clearingOma.value / compStats.vanhat.med - 1 : null;
    const hasClearing = !!(a.clearingPrice.oma || a.clearingPrice.vuokra);
    const hasStalled = !!(a.stalledPrice.oma || a.stalledPrice.vuokra);
    const whiteSpace = hot != null && hot >= 65 && st.sold12 >= 10 && st.pipelineUnits < Math.max(10, st.sold12 / 2);

    const areaInfo = area ? POSTAL_INFO[area.properties.code] : undefined;

    // biggest genuine unit-mix shortage in the radius (needs some volume behind it)
    const topGap = a.mixGap
        .filter(m => m.gap > 0.08 && m.sold + m.unsold >= 10)
        .sort((x, y) => y.gap - x.gap)[0] || null;

    // ── The verdict: 3–5 plain sentences that carry the main point ──
    const verdict: VerdictLine[] = [];
    {
        const mi = st.monthsInventory;
        if (st.projects === 0) {
            verdict.push({ tone: 'neu', text: 'Säteellä ei ole STH-seurattuja uudiskohteita — laajenna sädettä tai siirrä pistettä.' });
        } else if (mi == null) {
            verdict.push({ tone: 'neg', text: `Uudiskauppa on jäässä: ${st.forSale.toFixed(0)} asuntoa myynnissä eikä yhtään kauppaa 12 kuukauteen.` });
        } else if (mi <= 8) {
            verdict.push({ tone: 'pos', text: `Kysyntä vetää: ${st.sold12.toFixed(0)} kauppaa 12 kk:ssa ja varasto kiertäisi ${formatMonthsInv(mi)} kuukaudessa.` });
        } else if (mi <= 18) {
            verdict.push({ tone: 'neu', text: `Kauppa käy kohtuullisesti: ${st.sold12.toFixed(0)} kauppaa 12 kk:ssa, varastoa ${formatMonthsInv(mi)} kuukaudeksi.` });
        } else {
            verdict.push({ tone: 'neg', text: `Tarjontaa on kysyntään nähden paljon: nykyvarasto riittäisi ${formatMonthsInv(mi)} kuukaudeksi.` });
        }
        const top = a.products[0];
        if (top && st.projects > 0) {
            verdict.push({
                tone: 'neu',
                text: `Parhaiten liikkuu ${top.label.toLowerCase()}${topGap ? `; suurin vaje ${topGap.type}-asunnoista` : ''}.`,
            });
        }
        if (clearingOma) {
            verdict.push({
                tone: 'neu',
                text: `Kauppaava uudishinta omalla tontilla n. ${fmtEur(clearingOma.value)} €/m²${a.stalledPrice.oma ? ` — ${fmtEur(a.stalledPrice.oma.value)} €/m² pyynnit seisovat` : ''}.`,
            });
        } else if (a.clearingPrice.vuokra) {
            verdict.push({
                tone: 'neu',
                text: `Kauppaava uudishinta vuokratontilla n. ${fmtEur(a.clearingPrice.vuokra.value)} €/m² (ilman tonttia).`,
            });
        }
        if (premium != null && premium > 0.55) {
            verdict.push({ tone: 'neg', text: `Uudispreemio vanhaan kantaan +${Math.round(premium * 100)} % — korkea preemio hidastaa myyntiä.` });
        }
        if (whiteSpace) {
            verdict.push({ tone: 'pos', text: `Valkoinen alue: kysyntä vetää, mutta tulevaa tarjontaa on vain ${st.pipelineUnits.toFixed(0)} asuntoa.` });
        } else if (st.projects > 0 && st.pipelineUnits > Math.max(20, st.sold12 * 1.5)) {
            verdict.push({ tone: 'neg', text: `Keskeneräisissä kohteissa ${st.pipelineUnits.toFixed(0)} myymätöntä asuntoa — tuleva tarjonta painaa markkinaa.` });
        }
    }

    const copyTunnus = () => {
        if (!parcel) return;
        navigator.clipboard?.writeText(parcel.tunnus).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        }).catch(() => { });
    };

    const nearestListings = compStats
        ? [...compStats.sale]
            .sort((x, y) => {
                const dx = x.lat != null && x.lng != null ? haversineKm(point.lat, point.lng, x.lat, x.lng) : 99;
                const dy = y.lat != null && y.lng != null ? haversineKm(point.lat, point.lng, y.lat, y.lng) : 99;
                return dx - dy;
            })
            .slice(0, 8)
        : [];

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
                    {[1, 1.5, 2.5].map(r => (
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

                {/* Verdict hero: hotness score + plain-language main points */}
                <div className="px-4 py-3.5 border-b border-slate-100">
                    <div className="flex items-start gap-3.5">
                        <div className="relative w-[68px] h-[68px] flex-none" title="Postinumeroalueen kuumuuspisteet 0–100">
                            <svg viewBox="0 0 74 74" className="w-full h-full -rotate-90">
                                <circle cx="37" cy="37" r="31" fill="none" stroke="#f1f5f9" strokeWidth="7" />
                                {hot != null && (
                                    <circle cx="37" cy="37" r="31" fill="none" stroke={hotColor(hot)} strokeWidth="7" strokeLinecap="round"
                                        strokeDasharray={`${(hot / 100) * 2 * Math.PI * 31} ${2 * Math.PI * 31}`} />
                                )}
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <span className="text-[19px] font-extrabold leading-none">{hot ?? '–'}</span>
                                <span className="text-[8px] font-bold uppercase tracking-wide text-slate-400">Kuumuus</span>
                            </div>
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                            {verdict.map((v, i) => (
                                <div key={i} className="flex items-start gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full flex-none mt-[5px]" style={{ background: TONE_COLOR[v.tone] }} />
                                    <span className="text-[11px] leading-snug text-slate-700">{v.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
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

                {/* What to build — the actionable recommendation */}
                <Section title="Mitä tähän kannattaa rakentaa?">
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
                <Section title={`Markkinatilanne · ${String(radiusKm).replace('.', ',')} km`} badge={<span className="text-[10px] text-slate-400 font-semibold">{st.projects} kohdetta</span>}>
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
                                            {fmtKm(distanceKm)} · {p.completed ? 'valmis' : `valm. ${formatYm(p.completionYm)}`} · myyty {p.sold.toFixed(0)}/{p.units.toFixed(0)}
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

                {/* Price level */}
                <Section title="Hintataso">
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

                        <div className="border-t border-slate-100 my-1.5" />
                        <MicroLabel>Oikotie · myynnissä nyt (€/m², mediaani)</MicroLabel>
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
                                Uudishinnan preemio vanhaan kantaan <span className="text-slate-400">(oma tontti)</span>: <b>{premium >= 0 ? '+' : ''}{Math.round(premium * 100)} %</b>
                                {premium > 0.55 && ' — korkea preemio hidastaa myyntiä'}
                            </div>
                        )}
                        {compStats && (
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-600 mt-1">
                                <span>Vuokrat: <b>{compStats.rentAll.med ? `${compStats.rentAll.med.toFixed(1).replace('.', ',')} €/m²/kk` : '–'}</b> ({compStats.rentAll.n} kpl)</span>
                                {yieldOld != null && <span>Bruttotuotto vanhat: <b>{(yieldOld * 100).toFixed(1).replace('.', ',')} %</b></span>}
                                {yieldNew != null && <span>uudet: <b>{(yieldNew * 100).toFixed(1).replace('.', ',')} %</b></span>}
                            </div>
                        )}
                        {nearestListings.length > 0 && (
                            <>
                                <button onClick={() => setShowListings(!showListings)} className="text-[10.5px] text-blue-600 hover:underline font-semibold mt-1">
                                    {showListings ? 'Piilota kohteet' : `Näytä lähimmät myynti-ilmoitukset (${nearestListings.length})`}
                                </button>
                                {showListings && (
                                    <div className="space-y-1 mt-1">
                                        {nearestListings.map(l => (
                                            <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"
                                                className="flex items-baseline justify-between gap-2 text-[10.5px] hover:bg-slate-50 rounded px-1 py-0.5 -mx-1">
                                                <span className="truncate text-slate-700">{l.address || l.district} <span className="text-slate-400">· {l.year || '–'} · {l.sizeM2} m²</span></span>
                                                <span className="font-bold tabular-nums flex-none">{fmtEur(l.eurM2)} €/m²</span>
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </Section>

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
                    <span className="text-[10px] text-slate-400 font-semibold">{a.pipeline.length} kohdetta{plansNearby ? ` · ${plansNearby} kaavaa` : ''}</span>
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
                    Tilastokeskus Paavo · Maanmittauslaitos · OSM · Helsingin kaupunki
                </div>
            </div>
        </div>
    );

    return createPortal(panel, document.body);
}
