"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useMap, Marker, Popup, Circle, GeoJSON } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import * as XLSX from 'xlsx';
import { createPortal } from 'react-dom';
import SthProjectCard from './SthProjectCard';
import MarketAnalysisPanel from './MarketAnalysisPanel';
import {
    SthDataset, SthProject, AreaStats, buildDataset, computeAreaStats,
    gradeProject, formatSnapshot, fmtEur, ProductClass,
} from '@/lib/sthAnalysis';
import { loadPostalAreas, PostalAreaFC, ParcelInfo } from '@/lib/marketData';

// The STH market intelligence layer:
//  · absorption-graded project pins (data from /api/sales-data)
//  · postal-area choropleth (composite hotness by default)
//  · tap-anywhere market analysis (MarketAnalysisPanel)
//  · vireillä-kaavat overlay (Helsinki WFS via /api/market/plans)
//  · snapshot-aware Excel import (MML geocoding, keeps old snapshots for diffs)

interface Props {
    // each sub-layer is toggled independently from FilterPanel
    showProjects: boolean;
    showHeatmap: boolean;
    advisorOn: boolean;
    showPlans: boolean;
}

type CompletionFilter = 'kaikki' | 'valmis' | 'tuleva';

const PRODUCT_CHIPS: { id: ProductClass; label: string }[] = [
    { id: 'kt-kompakti', label: 'KT pieni' },
    { id: 'kt-keski', label: 'KT keski' },
    { id: 'kt-suuri', label: 'KT suuri' },
    { id: 'rivitalo', label: 'RT' },
    { id: 'pientalo', label: 'PT/OKT' },
];

// Choropleth metrics. `get` returns the raw value, `color` maps it to a fill.
const METRICS: Record<string, {
    label: string;
    get: (a: AreaStats) => number | null;
    color: (v: number | null) => string;
    fmt: (v: number | null) => string;
    legend: { color: string; label: string }[];
}> = {
    hotness: {
        label: 'Yhdistelmä (kuumuus)',
        get: a => a.hotness,
        color: v => v == null ? '#cbd5e1' : v >= 85 ? '#b91c1c' : v >= 70 ? '#ea580c' : v >= 55 ? '#f59e0b' : v >= 40 ? '#fcd34d' : v >= 25 ? '#bfdbfe' : '#93c5fd',
        fmt: v => v == null ? '–' : `${v}/100`,
        legend: [
            { color: '#b91c1c', label: '85+ erittäin kuuma' },
            { color: '#ea580c', label: '70–84 kuuma' },
            { color: '#f59e0b', label: '55–69 lämmin' },
            { color: '#fcd34d', label: '40–54 neutraali' },
            { color: '#93c5fd', label: '<40 viileä' },
        ],
    },
    months: {
        label: 'Varaston kesto (kk)',
        get: a => a.monthsInventory == null ? (a.forSale > 0 ? 999 : 0) : a.monthsInventory,
        color: v => v == null ? '#cbd5e1' : v <= 6 ? '#16a34a' : v <= 12 ? '#84cc16' : v <= 24 ? '#facc15' : v <= 48 ? '#fb923c' : '#dc2626',
        fmt: v => v == null ? '–' : v >= 999 ? '∞' : `${Math.round(v)} kk`,
        legend: [
            { color: '#16a34a', label: '≤6 kk' },
            { color: '#84cc16', label: '6–12 kk' },
            { color: '#facc15', label: '12–24 kk' },
            { color: '#fb923c', label: '24–48 kk' },
            { color: '#dc2626', label: '>48 kk' },
        ],
    },
    sold12: {
        label: 'Myynti 12 kk (kpl)',
        get: a => a.sold12,
        color: v => v == null || v <= 0 ? '#e2e8f0' : v < 10 ? '#dbeafe' : v < 25 ? '#93c5fd' : v < 50 ? '#60a5fa' : v < 90 ? '#3b82f6' : '#1d4ed8',
        fmt: v => v == null ? '–' : `${Math.round(v)} kpl`,
        legend: [
            { color: '#dbeafe', label: '1–9' },
            { color: '#93c5fd', label: '10–24' },
            { color: '#60a5fa', label: '25–49' },
            { color: '#3b82f6', label: '50–89' },
            { color: '#1d4ed8', label: '90+' },
        ],
    },
    eurm2: {
        // leasehold €/m² excludes the land, so the fill uses owned-plot medians;
        // areas with only leasehold stock fall back to the lease median and the
        // tooltip says so.
        label: 'Mediaanihinta €/m² (oma tontti)',
        get: a => a.medEurM2Own ?? a.medEurM2Lease,
        color: v => v == null ? '#cbd5e1' : v < 4500 ? '#ede9fe' : v < 5500 ? '#ddd6fe' : v < 6500 ? '#c4b5fd' : v < 8000 ? '#a78bfa' : v < 10000 ? '#8b5cf6' : '#6d28d9',
        fmt: v => v == null ? '–' : `${fmtEur(v)} €/m²`,
        legend: [
            { color: '#ede9fe', label: '<4 500' },
            { color: '#ddd6fe', label: '4 500–5 500' },
            { color: '#c4b5fd', label: '5 500–6 500' },
            { color: '#a78bfa', label: '6 500–8 000' },
            { color: '#8b5cf6', label: '8 000–10 000' },
            { color: '#6d28d9', label: '>10 000' },
        ],
    },
    momentum: {
        label: 'Momentum (6 kk vs 12 kk)',
        get: a => a.momentum,
        color: v => v == null ? '#cbd5e1' : v < 0.6 ? '#dc2626' : v < 0.85 ? '#fb923c' : v < 1.15 ? '#e2e8f0' : v < 1.5 ? '#86efac' : '#16a34a',
        fmt: v => v == null ? '–' : `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)} %`,
        legend: [
            { color: '#16a34a', label: 'Kiihtyy +50 %' },
            { color: '#86efac', label: '+15…50 %' },
            { color: '#e2e8f0', label: 'Vakaa' },
            { color: '#fb923c', label: '−15…40 %' },
            { color: '#dc2626', label: 'Hidastuu' },
        ],
    },
};

function ClickCatcher({ onClick }: { onClick: (lat: number, lng: number) => void }) {
    const map = useMap();
    useEffect(() => {
        const handler = (e: L.LeafletMouseEvent) => onClick(e.latlng.lat, e.latlng.lng);
        map.on('click', handler);
        const el = map.getContainer();
        const oldCursor = el.style.cursor;
        el.style.cursor = 'crosshair';
        return () => {
            map.off('click', handler);
            el.style.cursor = oldCursor;
        };
    }, [map, onClick]);
    return null;
}

function Switch({ on }: { on: boolean }) {
    return (
        <span className={`relative inline-flex h-4 w-7 flex-none items-center rounded-full transition-colors ${on ? 'bg-blue-600' : 'bg-slate-300'}`}>
            <span className={`h-2.5 w-2.5 rounded-full bg-white shadow-sm transform transition-transform ${on ? 'translate-x-[15px]' : 'translate-x-[3px]'}`} />
        </span>
    );
}

export default function SthMarketLayer({ showProjects, showHeatmap, advisorOn, showPlans }: Props) {
    const map = useMap();
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState('');

    // any sub-layer being on means the dataset is needed
    const visible = showProjects || showHeatmap || advisorOn || showPlans;
    const [metric, setMetric] = useState<string>('hotness');

    // pin filters
    const [productFilter, setProductFilter] = useState<ProductClass[]>([]);
    const [tenureFilter, setTenureFilter] = useState<('oma' | 'vuokra')[]>([]);
    const [builderFilter, setBuilderFilter] = useState('');
    const [completionFilter, setCompletionFilter] = useState<CompletionFilter>('kaikki');
    const [onlyForSale, setOnlyForSale] = useState(true);
    const [onlyCuts, setOnlyCuts] = useState(false);

    // advisor state
    const [analysisPoint, setAnalysisPoint] = useState<{ lat: number; lng: number } | null>(null);
    // 1 km default: larger radii pull in projects from across water/rail
    // barriers (e.g. Katajanokka picking up Sompasaari) — tight by default
    const [radiusKm, setRadiusKm] = useState(1);
    const [parcel, setParcel] = useState<ParcelInfo | null>(null);

    const [postalFC, setPostalFC] = useState<PostalAreaFC | null>(null);
    const [plans, setPlans] = useState<any | null>(null);
    const [containers, setContainers] = useState<Record<string, HTMLElement | null>>({});
    const loadedRef = useRef(false);
    const advisorOnRef = useRef(advisorOn);
    advisorOnRef.current = advisorOn;
    const fileInputRef = useRef<HTMLInputElement>(null);

    // portal targets appear when the matching layer is toggled on in FilterPanel
    useEffect(() => {
        const t = setTimeout(() => setContainers({
            projects: showProjects ? document.getElementById('sth-projects-filters-container') : null,
            heatmap: showHeatmap ? document.getElementById('sth-heatmap-filters-container') : null,
            advisor: advisorOn ? document.getElementById('sth-analysis-filters-container') : null,
        }), 0);
        return () => clearTimeout(t);
    }, [showProjects, showHeatmap, advisorOn]);

    // data load (once)
    useEffect(() => {
        if (!visible || loadedRef.current) return;
        loadedRef.current = true;
        setLoading(true);
        fetch('/api/sales-data')
            .then(r => r.json())
            .then(d => { if (Array.isArray(d)) setRows(d); })
            .catch(err => console.error('sales-data load failed', err))
            .finally(() => setLoading(false));
        loadPostalAreas().then(setPostalFC).catch(() => { });
    }, [visible]);

    // plans load (lazy: needed by overlay and analysis panel)
    useEffect(() => {
        if (!visible || plans || (!showPlans && !analysisPoint)) return;
        fetch('/api/market/plans').then(r => r.json()).then(setPlans).catch(() => { });
    }, [visible, showPlans, analysisPoint, plans]);

    // kiinteistötunnus of the clicked point (MML parcel lookup)
    useEffect(() => {
        setParcel(null);
        if (!analysisPoint) return;
        let cancelled = false;
        fetch(`/api/market/property?lat=${analysisPoint.lat}&lon=${analysisPoint.lng}`)
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(d => { if (!cancelled) setParcel(d.parcel || null); })
            .catch(() => { if (!cancelled) setParcel(null); });
        return () => { cancelled = true; };
    }, [analysisPoint]);

    const dataset: SthDataset = useMemo(() => buildDataset(rows), [rows]);
    const areaStats = useMemo(() => computeAreaStats(dataset.projects), [dataset]);

    const builders = useMemo(() => {
        const counts = new Map<string, number>();
        for (const p of dataset.projects) {
            if (!p.builder || p.builder === 'Ei ole tiedossa') continue;
            counts.set(p.builder, (counts.get(p.builder) || 0) + 1);
        }
        return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([name, cnt]) => ({ name, cnt }));
    }, [dataset]);

    const visibleProjects = useMemo(() => {
        return dataset.projects.filter(p => {
            if (onlyForSale && p.forSale <= 0) return false;
            if (onlyCuts && !p.priceCut) return false;
            if (productFilter.length && !productFilter.includes(p.productClass)) return false;
            if (tenureFilter.length) {
                // 'seka' (mixed forms) counts as leasehold for filtering
                const g = p.tenure === 'oma' ? 'oma' : 'vuokra';
                if (!tenureFilter.includes(g)) return false;
            }
            if (builderFilter && p.builder !== builderFilter) return false;
            if (completionFilter === 'valmis' && !p.completed) return false;
            if (completionFilter === 'tuleva' && p.completed) return false;
            return true;
        });
    }, [dataset, onlyForSale, onlyCuts, productFilter, tenureFilter, builderFilter, completionFilter]);

    // closing the advisor layer also closes its panel
    useEffect(() => {
        if (!advisorOn) setAnalysisPoint(null);
    }, [advisorOn]);

    const handleAdvisorClick = useCallback((lat: number, lng: number) => {
        setAnalysisPoint({ lat, lng });
    }, []);

    // ── Excel import (snapshot-aware, MML geocoding) ─────────
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLoading(true);
        setProgress('Luetaan tiedostoa…');
        try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(ws, { header: 'A', range: 5 }) as any[];
            const validRows = jsonData.filter(r => r['E'] && r['A'] && r['B']);
            if (!validRows.length) throw new Error('Tiedostosta ei löytynyt rivejä (sarakkeet A/B/E puuttuvat)');
            const snapshot = String(Math.round(Number(validRows[0]['B'])));

            // reuse coordinates from every already-loaded snapshot
            const known = new Map<string, { lat: number; lng: number }>();
            for (const r of rows) {
                if (r.address_key) known.set(r.address_key, { lat: r.lat, lng: r.lng });
            }

            const items: any[] = [];
            const failed: string[] = [];
            for (let i = 0; i < validRows.length; i++) {
                const row = validRows[i];
                const address = String(row['E']).trim();
                const city = String(row['A']).trim();
                const key = `${address}, ${city}`.toLowerCase();
                let coords = known.get(key);
                if (!coords) {
                    setProgress(`Geokoodataan ${i + 1}/${validRows.length}: ${address}`);
                    try {
                        const simple = address.split('&')[0].replace(/(\d+)\s*[-–]\s*\d+.*$/, '$1').replace(/(\d+)\s*[a-dA-D].*$/, '$1').trim();
                        const res = await fetch(`/api/geocode?text=${encodeURIComponent(`${simple}, ${city}`)}`);
                        const g = await res.json();
                        if (Array.isArray(g) && g.length) {
                            coords = { lat: parseFloat(g[0].lat), lng: parseFloat(g[0].lon) };
                        }
                        await new Promise(r => setTimeout(r, 120));
                    } catch { /* jatketaan */ }
                }
                if (coords) items.push({ data: row, lat: coords.lat, lng: coords.lng, address_key: key });
                else failed.push(address);
            }

            setProgress('Tallennetaan tietokantaan…');
            const res = await fetch('/api/sales-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'replaceSnapshot', snapshot, data: items }),
            });
            if (!res.ok) throw new Error('Tallennus epäonnistui');

            const fresh = await fetch('/api/sales-data').then(r => r.json());
            if (Array.isArray(fresh)) setRows(fresh);
            setProgress('');
            alert(`Tilanne ${snapshot} tuotu: ${items.length} kohdetta.${failed.length ? `\nIlman sijaintia jäi ${failed.length}: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}` : ''}`);
        } catch (err: any) {
            console.error(err);
            alert(`Virhe tuonnissa: ${err?.message || err}`);
            setProgress('');
        } finally {
            setLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // ── Marker icon ──────────────────────────────────────────
    // Minimal pill: absorption dot + price. Tenure is the pill's pastel color
    // (blue = oma tontti, amber = vuokratontti, whose €/m² excludes the land).
    // Details live in the popup card; the pin stays quiet.
    const createIcon = (p: SthProject) => {
        const grade = gradeProject(p);
        const soldOut = p.forSale <= 0;
        const isLease = p.tenure !== 'oma';
        const price = p.eurM2 ? fmtEur(Math.round(p.eurM2 / 100) * 100) : '?';
        const hint = `${isLease ? 'Vuokratontti (hinta ilman tonttia)' : 'Oma tontti'} · ${grade.label}`;
        const icon = L.divIcon({
            className: 'custom-plot-icon',
            html: `<div class="plot-pin-center"><div class="sth-pill ${isLease ? 'sth-vuokra' : 'sth-oma'}${soldOut ? ' sth-soldout' : ''}" title="${hint}">
                <span class="plot-pill-dot" style="background:${grade.color};"></span>
                <span>${price}</span>
            </div></div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
            popupAnchor: [0, -16],
        });
        // carry data for the cluster badge (median €/m² of collapsed pins)
        (icon.options as any).sthEurM2 = p.eurM2 || null;
        (icon.options as any).sthTenure = isLease ? 'vuokra' : 'oma';
        return icon;
    };

    // Cluster badge: count + median €/m², split by tenure so owned-plot and
    // leasehold prices never blend into one misleading number.
    const clusterIcon = (cluster: any) => {
        const markers = cluster.getAllChildMarkers();
        const own: number[] = [];
        const lease: number[] = [];
        for (const m of markers) {
            const opts = m?.options?.icon?.options as any;
            const v = opts?.sthEurM2;
            if (typeof v === 'number' && v > 0) {
                (opts?.sthTenure === 'vuokra' ? lease : own).push(v);
            }
        }
        const med = (vals: number[]) => {
            if (!vals.length) return null;
            const s = [...vals].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };
        const mo = med(own);
        const ml = med(lease);
        const parts: string[] = [];
        if (mo != null) parts.push(`<span class="sth-cluster-row sth-oma">${fmtEur(Math.round(mo / 100) * 100)}</span>`);
        if (ml != null) parts.push(`<span class="sth-cluster-row sth-vuokra">${fmtEur(Math.round(ml / 100) * 100)}</span>`);
        return L.divIcon({
            html: `<div class="plot-pin-center"><div class="sth-cluster-pill">
                <span class="sth-cluster-count">${cluster.getChildCount()}</span>
                <span class="sth-cluster-prices">${parts.join('') || '–'}</span>
            </div></div>`,
            className: 'custom-plot-icon',
            iconSize: [0, 0],
            iconAnchor: [0, 0],
        });
    };

    // ── Choropleth ───────────────────────────────────────────
    const metricCfg = METRICS[metric];
    const choroplethStyle = useCallback((feature: any) => {
        const stat = areaStats.get(feature?.properties?.code);
        if (!stat) return { color: '#94a3b8', weight: 0.5, fillColor: '#94a3b8', fillOpacity: 0.04 };
        const v = metricCfg.get(stat);
        return {
            color: '#ffffff',
            weight: 1,
            fillColor: metricCfg.color(v),
            fillOpacity: 0.55,
        };
    }, [areaStats, metricCfg]);

    const onEachArea = useCallback((feature: any, layer: L.Layer) => {
        const props = feature.properties;
        const stat = areaStats.get(props.code);
        const v = stat ? metricCfg.fmt(metricCfg.get(stat)) : 'ei kohteita';
        // price context always split by tenure — never one pooled median
        const priceLine = stat
            ? [
                stat.medEurM2Own != null ? `Oma tontti ${fmtEur(stat.medEurM2Own)} €/m² (${stat.ownCount})` : null,
                stat.medEurM2Lease != null ? `Vuokratontti ${fmtEur(stat.medEurM2Lease)} €/m² (${stat.leaseCount})` : null,
            ].filter(Boolean).join(' · ')
            : '';
        (layer as any).bindTooltip(
            `<b>${props.code} ${props.name}</b><br/>${metricCfg.label}: ${v}${stat ? `<br/>${stat.projects} kohdetta · ${stat.sold12} myyty 12 kk` : ''}${priceLine ? `<br/>${priceLine}` : ''}`,
            { sticky: true, className: 'sth-tooltip' }
        );
        layer.on('click', (e: any) => {
            if (!advisorOnRef.current) return;
            L.DomEvent.stopPropagation(e);
            setAnalysisPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
    }, [areaStats, metricCfg]);

    if (!visible) return null;

    // ── Status line, shared by the panels ────────────────────
    const statusLine = (
        <div className="text-[10.5px] text-slate-500">
            {loading ? (progress || 'Ladataan…') : dataset.snapshot
                ? <>Tilanne <b>{formatSnapshot(dataset.snapshot)}</b> · {dataset.projects.length} kohdetta{dataset.prevSnapshot ? <> · vertailu {formatSnapshot(dataset.prevSnapshot)}</> : null}</>
                : 'Ei dataa — tuo STH-Excel alta.'}
        </div>
    );

    // ── Heatmap panel (portalled into FilterPanel) ───────────
    const heatmapPanel = (
        <div className="space-y-3">
            {statusLine}
            <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-1">Väritys</label>
                <select
                    value={metric}
                    onChange={e => setMetric(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none"
                >
                    {Object.entries(METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
            </div>
        </div>
    );

    // ── Advisor panel (portalled into FilterPanel) ───────────
    const advisorPanel = (
        <div className="space-y-2">
            <div className="text-[10.5px] text-slate-500">
                Klikkaa karttaa avataksesi markkina-analyysin valitulta säteeltä.
            </div>
            <div>
                <label className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-1">
                    <span>Säde</span>
                    <span className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[10px] normal-case tracking-normal">{radiusKm.toFixed(1)} km</span>
                </label>
                <input
                    type="range" min="0.5" max="5" step="0.5" value={radiusKm}
                    onChange={e => setRadiusKm(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
            </div>
            {analysisPoint && (
                <button
                    onClick={() => setAnalysisPoint(null)}
                    className="text-[11px] font-medium text-slate-500 hover:text-slate-800 underline underline-offset-2"
                >
                    Tyhjennä valinta
                </button>
            )}
        </div>
    );

    // ── Projects panel (portalled into FilterPanel) ──────────
    const projectsPanel = (
        <div className="space-y-3">
            {statusLine}

            {/* Pin filters */}
            <div className="space-y-2.5">
                    <div className="flex flex-wrap gap-1">
                        {PRODUCT_CHIPS.map(c => {
                            const on = productFilter.includes(c.id);
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => setProductFilter(on ? productFilter.filter(x => x !== c.id) : [...productFilter, c.id])}
                                    className={`px-2 py-1 text-[10.5px] font-semibold rounded-full border transition-all ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                                >
                                    {c.label}
                                </button>
                            );
                        })}
                    </div>
                    {/* Tenure filter — owned vs leasehold prices are different markets */}
                    <div className="flex flex-wrap gap-1">
                        {([
                            { id: 'oma' as const, label: 'Oma tontti' },
                            { id: 'vuokra' as const, label: 'Vuokratontti' },
                        ]).map(t => {
                            const on = tenureFilter.includes(t.id);
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => setTenureFilter(on ? tenureFilter.filter(x => x !== t.id) : [...tenureFilter, t.id])}
                                    className="px-2 py-1 text-[10.5px] font-semibold rounded-full border transition-all"
                                    style={on
                                        ? (t.id === 'oma'
                                            ? { background: '#d8e7fa', borderColor: 'rgba(37,99,235,0.45)', color: '#1e40af' }
                                            : { background: '#fdeec9', borderColor: 'rgba(217,119,6,0.5)', color: '#92400e' })
                                        : { background: '#fff', borderColor: '#e2e8f0', color: '#64748b' }}
                                >
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex gap-1.5">
                        <select
                            value={builderFilter}
                            onChange={e => setBuilderFilter(e.target.value)}
                            className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none"
                        >
                            <option value="">Kaikki rakentajat</option>
                            {builders.slice(0, 40).map(b => <option key={b.name} value={b.name}>{b.name} ({b.cnt})</option>)}
                        </select>
                        <select
                            value={completionFilter}
                            onChange={e => setCompletionFilter(e.target.value as CompletionFilter)}
                            className="w-[92px] px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none"
                        >
                            <option value="kaikki">Kaikki</option>
                            <option value="valmis">Valmiit</option>
                            <option value="tuleva">Tulevat</option>
                        </select>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-600">
                            <input type="checkbox" checked={onlyForSale} onChange={e => setOnlyForSale(e.target.checked)} className="rounded border-slate-300 w-3.5 h-3.5" />
                            Vain myynnissä olevat
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-600">
                            <input type="checkbox" checked={onlyCuts} onChange={e => setOnlyCuts(e.target.checked)} className="rounded border-slate-300 w-3.5 h-3.5" />
                            Vain alennetut ↓
                        </label>
                    </div>
                    <div className="text-[10px] text-slate-400">{visibleProjects.length} / {dataset.projects.length} kohdetta näkyvissä</div>
                    {/* absorption + tenure legend */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-slate-500">
                        {[
                            { c: '#16a34a', l: '≤6 kk' },
                            { c: '#65a30d', l: '≤12 kk' },
                            { c: '#d97706', l: '≤24 kk' },
                            { c: '#dc2626', l: 'seisoo' },
                            { c: '#7c3aed', l: 'uusi' },
                        ].map(x => (
                            <span key={x.l} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: x.c }} />{x.l}</span>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-slate-500">
                        <span className="flex items-center gap-1"><span className="inline-block w-5 h-3 rounded-full" style={{ background: '#d8e7fa', border: '1px solid rgba(37,99,235,0.35)' }} />oma tontti</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-5 h-3 rounded-full" style={{ background: '#fdeec9', border: '1px solid rgba(217,119,6,0.4)' }} />vuokratontti (hinta ilman tonttia)</span>
                </div>
            </div>

            {/* Import */}
            <div className="border-t border-slate-100 pt-2.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-1">Tuo uusi STH-Excel</label>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleFileUpload}
                    disabled={loading}
                    className="block w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 disabled:opacity-50"
                />
                <div className="text-[9.5px] text-slate-400 mt-1">Sama tilannepäivä korvataan; vanhat tilanteet säilyvät vertailua varten.</div>
                {progress && <div className="text-[10px] font-medium text-blue-600 mt-1">{progress}</div>}
            </div>
        </div>
    );

    // ── Map legend for choropleth ────────────────────────────
    const legend = showHeatmap ? (
        <div className="absolute bottom-6 left-3 z-[900] bg-white/95 rounded-lg shadow-md border border-slate-200 px-2.5 py-2 pointer-events-none">
            <div className="text-[9px] font-bold uppercase tracking-[0.06em] text-slate-500 mb-1">{metricCfg.label}</div>
            <div className="space-y-0.5">
                {metricCfg.legend.map(row => (
                    <div key={row.label} className="flex items-center gap-1.5 text-[9.5px] text-slate-600">
                        <span className="w-3 h-2.5 rounded-sm" style={{ background: row.color }} />
                        {row.label}
                    </div>
                ))}
            </div>
        </div>
    ) : null;

    return (
        <>
            {containers.projects && createPortal(projectsPanel, containers.projects)}
            {containers.heatmap && createPortal(heatmapPanel, containers.heatmap)}
            {containers.advisor && createPortal(advisorPanel, containers.advisor)}
            {legend && createPortal(legend, map.getContainer())}

            {/* Choropleth */}
            {showHeatmap && postalFC && (
                <GeoJSON
                    key={`choro-${metric}-${dataset.snapshot}`}
                    data={postalFC as any}
                    style={choroplethStyle}
                    onEachFeature={onEachArea}
                />
            )}

            {/* Plans overlay */}
            {showPlans && plans?.features?.length > 0 && (
                <GeoJSON
                    key="plans"
                    data={plans as any}
                    style={{ color: '#7c3aed', weight: 1.5, dashArray: '4 3', fillColor: '#a78bfa', fillOpacity: 0.18 }}
                    onEachFeature={(f: any, layer: any) => {
                        const p = f.properties || {};
                        layer.bindPopup(
                            `<div style="font-size:12px;min-width:170px;">
                                <b>Asemakaava vireillä</b><br/>
                                Kaavatunnus: <b>${p.kaavatunnus || '–'}</b><br/>
                                ${p.hyvaksymispvm ? `Hyväksyminen: ${p.hyvaksymispvm}<br/>` : ''}
                                ${p.pintaala ? `Pinta-ala: ${Math.round(p.pintaala / 1000)/10} ha<br/>` : ''}
                                <a href="https://kartta.hel.fi/?setlanguage=fi&autosearch=${encodeURIComponent(p.kaavatunnus || '')}" target="_blank" style="color:#2563eb;">Avaa kartta.hel.fi →</a>
                            </div>`
                        );
                    }}
                />
            )}

            {/* Project pins */}
            {showProjects && (
                <MarkerClusterGroup
                    key={`sth-cluster-${visibleProjects.length}`}
                    chunkedLoading
                    maxClusterRadius={44}
                    showCoverageOnHover={false}
                    spiderfyOnMaxZoom={true}
                    disableClusteringAtZoom={13}
                    iconCreateFunction={clusterIcon}
                >
                    {visibleProjects.map(p => (
                        <Marker key={p.key} position={[p.lat, p.lng]} icon={createIcon(p)}>
                            <Popup className="plot-popup" minWidth={300} maxWidth={300}>
                                <SthProjectCard project={p} />
                            </Popup>
                        </Marker>
                    ))}
                </MarkerClusterGroup>
            )}

            {/* Advisor */}
            {advisorOn && <ClickCatcher onClick={handleAdvisorClick} />}
            {analysisPoint && (
                <>
                    <Circle
                        center={[analysisPoint.lat, analysisPoint.lng]}
                        radius={radiusKm * 1000}
                        pathOptions={{ color: '#2563eb', weight: 1.5, dashArray: '5 4', fillColor: '#3b82f6', fillOpacity: 0.05 }}
                    />
                    {/* clicked parcel boundary (MML) */}
                    {parcel?.geometry && (
                        <GeoJSON
                            key={`parcel-${parcel.kiinteistotunnus}`}
                            data={{ type: 'Feature', properties: {}, geometry: parcel.geometry } as any}
                            style={{ color: '#1d4ed8', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.08 }}
                            interactive={false}
                        />
                    )}
                    <Marker
                        position={[analysisPoint.lat, analysisPoint.lng]}
                        icon={L.divIcon({
                            className: 'custom-plot-icon',
                            html: '<div class="sth-crosshair"></div>',
                            iconSize: [18, 18],
                            iconAnchor: [9, 9],
                        })}
                    />
                </>
            )}

            <MarketAnalysisPanel
                open={!!analysisPoint}
                point={analysisPoint}
                radiusKm={radiusKm}
                onRadiusChange={setRadiusKm}
                dataset={dataset}
                areaStats={areaStats}
                plans={plans}
                parcel={parcel}
                onClose={() => setAnalysisPoint(null)}
            />
        </>
    );
}
