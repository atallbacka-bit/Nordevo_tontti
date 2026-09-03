"use client";

import React, { useMemo } from 'react';
import { Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { CompListing, AgeBucket, AGE_BUCKET_LABEL, COMPS_TAG, rentBucket, isSaleNew } from '@/lib/comps';
import { haversineKm, fmtEur } from '@/lib/sthAnalysis';
import { fmtKm } from '@/lib/marketData';
import { useT } from '@/lib/i18n';

// Oikotie listings around the market-analysis point, drawn as pins so the
// panel's rent and asking-price medians have a spatial picture behind them.
//  · one tag per building: listings sharing coordinates collapse into one tag
//    showing the building median — rent €/m²/kk (teal) or asking €/m² (indigo)
//  · deliberately a different family from the STH pins: STH speaks in rounded
//    pastel pills with a status dot; these are square-cornered white tags with
//    a thick colour spine on the left and coloured text, no dot — so a listing
//    is never mistaken for a tracked project
//  · full opacity inside the radius buffer the panel medians use, faded
//    outside; the whole fetched postcode set is drawn because the uudisvuokra
//    tiers fall back to it when the radius alone is too thin
//  · clusters show listing count + a median per kind, never one pooled number
// Rendered by MarketAnalysisPanel, which sits inside the MapContainer tree.

interface Props {
    point: { lat: number; lng: number };
    radiusKm: number;
    rent: CompListing[];
    sale: CompListing[];
    rentBuckets: AgeBucket[];   // which rent age buckets to draw
    showSale: boolean;          // draw Oikotie new-build sale listings too
}

type Kind = 'rent' | 'sale';

interface BuildingPin {
    key: string;
    kind: Kind;
    lat: number;
    lng: number;
    listings: CompListing[];
    med: number;
    inRadius: boolean;
    bucket: AgeBucket;
    distKm: number;
}

// spine shade carries the rent age bucket; sale tags are always new-build
const { rentText: RENT_TEXT, rentSpine: RENT_SPINE, saleText: SALE_TEXT, saleSpine: SALE_SPINE } = COMPS_TAG;
const RADIUS_BUFFER_KM = 0.6; // same buffer MarketAnalysisPanel uses for its medians

const fmt1 = (v: number) => v.toFixed(1).replace('.', ',');

function median(vals: number[]): number | null {
    const s = vals.filter(v => isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const fmtValue = (kind: Kind, v: number) =>
    kind === 'rent' ? `${fmt1(v)} €/m²/kk` : `${fmtEur(Math.round(v / 100) * 100)} €/m²`;

function buildPins(kind: Kind, list: CompListing[], point: Props['point'], radiusKm: number, nowYear: number): BuildingPin[] {
    const groups = new Map<string, CompListing[]>();
    for (const l of list) {
        if (l.lat == null || l.lng == null) continue;
        // ~1 m grid: every listing of one building carries the same Oikotie coordinate
        const k = `${l.lat.toFixed(5)},${l.lng.toFixed(5)}`;
        const g = groups.get(k);
        if (g) g.push(l); else groups.set(k, [l]);
    }
    const pins: BuildingPin[] = [];
    groups.forEach((listings, k) => {
        const med = median(listings.map(l => l.eurM2));
        if (med == null) return;
        const lat = listings[0].lat!, lng = listings[0].lng!;
        const distKm = haversineKm(point.lat, point.lng, lat, lng);
        // dominant bucket: a building has one year, but newDev flags can differ per listing
        const counts: Record<AgeBucket, number> = { uudet: 0, uudehkot: 0, vanhat: 0 };
        for (const l of listings) counts[kind === 'rent' ? rentBucket(l, nowYear) : 'uudet']++;
        const bucket = (Object.keys(counts) as AgeBucket[]).sort((a, b) => counts[b] - counts[a])[0];
        pins.push({
            key: `${kind}-${k}`, kind, lat, lng,
            listings: [...listings].sort((a, b) => a.eurM2 - b.eurM2),
            med, inRadius: distKm <= radiusKm + RADIUS_BUFFER_KM, bucket, distKm,
        });
    });
    return pins;
}

function pinIcon(p: BuildingPin, title: string) {
    const spine = p.kind === 'rent' ? RENT_SPINE[p.bucket] : SALE_SPINE;
    const text = p.kind === 'rent' ? RENT_TEXT : SALE_TEXT;
    const icon = L.divIcon({
        className: 'custom-plot-icon',
        html: `<div class="plot-pin-center"><div class="cmp-tag ${p.kind === 'rent' ? 'cmp-rent' : 'cmp-sale'}${p.inRadius ? '' : ' cmp-out'}" style="border-left-color:${spine};" title="${title}">
            <span>${fmtValue(p.kind, p.med)}</span>${p.listings.length > 1 ? `<span class="cmp-n" style="background:${text};">${p.listings.length}</span>` : ''}
        </div></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        popupAnchor: [0, -16],
    });
    // carried for the cluster badge
    (icon.options as any).cmpKind = p.kind;
    (icon.options as any).cmpVals = p.listings.map(l => l.eurM2);
    return icon;
}

// Cluster badge: listing count + median per kind, rent and asking never blended.
const clusterIcon = (cluster: any) => {
    const rentVals: number[] = [];
    const saleVals: number[] = [];
    for (const m of cluster.getAllChildMarkers()) {
        const o = m?.options?.icon?.options as any;
        if (!Array.isArray(o?.cmpVals)) continue;
        (o.cmpKind === 'rent' ? rentVals : saleVals).push(...o.cmpVals);
    }
    const rows: string[] = [];
    const mr = median(rentVals), ms = median(saleVals);
    if (mr != null) rows.push(`<span class="cmp-cluster-row cmp-rent">${fmtValue('rent', mr)}</span>`);
    if (ms != null) rows.push(`<span class="cmp-cluster-row cmp-sale">${fmtValue('sale', ms)}</span>`);
    return L.divIcon({
        html: `<div class="plot-pin-center"><div class="cmp-cluster">
            <span class="cmp-cluster-count">${rentVals.length + saleVals.length}</span>
            <span class="cmp-cluster-rows">${rows.join('') || '–'}</span>
        </div></div>`,
        className: 'custom-plot-icon',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
    });
};

// Popup: the building's listings, cheapest first, each linking to Oikotie.
function BuildingCard({ pin }: { pin: BuildingPin }) {
    const t = useT();
    const isRent = pin.kind === 'rent';
    const first = pin.listings[0];
    const shown = pin.listings.slice(0, 8);
    return (
        <div className="px-1 py-0.5 font-sans text-slate-900">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-bold truncate">{first.address || first.district || first.postcode}</span>
                <span className="text-[10px] text-slate-400 flex-none tabular-nums">{first.year ?? '–'} · {fmtKm(pin.distKm)}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                {/* source badge in the tag's own colours — the card says where the number comes from */}
                <span
                    className="px-1 rounded-[3px] border border-l-4 text-[8.5px] font-bold uppercase tracking-wide leading-relaxed"
                    style={{ borderColor: isRent ? RENT_TEXT : SALE_TEXT, borderLeftColor: isRent ? RENT_SPINE[pin.bucket] : SALE_SPINE, color: isRent ? RENT_TEXT : SALE_TEXT }}
                >
                    Oikotie
                </span>
                <span>
                    {isRent ? t('Vuokrapyynnöt') : t('Uudiskohde myynnissä')}
                    {isRent && <> · {t(AGE_BUCKET_LABEL[pin.bucket]).toLowerCase()}</>}
                    {' · '}{t('{n} ilmoitusta', { n: pin.listings.length })}
                    {!pin.inRadius && <> · {t('säteen ulkopuolella')}</>}
                </span>
            </div>
            <div className="flex items-baseline gap-1 mt-1">
                <span className="text-[15px] font-extrabold tabular-nums">{isRent ? fmt1(pin.med) : fmtEur(pin.med)}</span>
                <span className="text-[9.5px] font-bold text-slate-400">{isRent ? '€/m²/kk' : '€/m²'} · {t('mediaani')}</span>
            </div>
            <div className="mt-1.5 space-y-0.5 border-t border-slate-100 pt-1.5">
                {shown.map(l => (
                    <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-baseline justify-between gap-2 text-[10.5px] hover:bg-slate-50 rounded px-1 py-0.5 -mx-1">
                        <span className="truncate text-slate-700">
                            {l.roomConfig || (l.rooms ? `${l.rooms}h` : '–')} · {l.sizeM2} m²
                            {l.daysOnMarket != null && (
                                <span className={l.daysOnMarket > 90 ? 'text-red-500' : 'text-slate-400'}> · {t('{n} vrk', { n: l.daysOnMarket })}</span>
                            )}
                            {l.priceCut && <span className="text-amber-600 font-semibold"> {t('↓hinta')}</span>}
                        </span>
                        <span className="font-bold tabular-nums flex-none">
                            {isRent ? fmt1(l.eurM2) : fmtEur(l.eurM2)}
                            <span className="text-slate-400 font-medium"> · {fmtEur(l.price)} {isRent ? '€/kk' : '€'}</span>
                        </span>
                    </a>
                ))}
                {pin.listings.length > shown.length && (
                    <div className="text-[10px] text-slate-400">{t('+ {n} muuta ilmoitusta', { n: pin.listings.length - shown.length })}</div>
                )}
            </div>
        </div>
    );
}

export default function CompsMapLayer({ point, radiusKm, rent, sale, rentBuckets, showSale }: Props) {
    const t = useT();
    const pins = useMemo(() => {
        const nowYear = new Date().getFullYear();
        const rentList = rent.filter(l => rentBuckets.includes(rentBucket(l, nowYear)));
        const saleList = showSale ? sale.filter(l => isSaleNew(l, nowYear)) : [];
        return [
            ...buildPins('rent', rentList, point, radiusKm, nowYear),
            ...buildPins('sale', saleList, point, radiusKm, nowYear),
        ];
    }, [point, radiusKm, rent, sale, rentBuckets, showSale]);

    if (!pins.length) return null;

    const pinTitle = (p: BuildingPin) => p.kind === 'rent'
        ? `${t('Vuokrapyynnöt')} · ${t(AGE_BUCKET_LABEL[p.bucket])} · ${t('{n} ilmoitusta', { n: p.listings.length })}`
        : `${t('Uudiskohde myynnissä')} · ${t('{n} ilmoitusta', { n: p.listings.length })}`;

    return (
        <MarkerClusterGroup
            // remount when the pin set changes — the cluster plugin does not diff children reliably
            key={`cmp-${point.lat},${point.lng}-${pins.length}-${rentBuckets.join('')}-${showSale ? 's' : ''}`}
            chunkedLoading
            maxClusterRadius={40}
            showCoverageOnHover={false}
            spiderfyOnMaxZoom={true}
            disableClusteringAtZoom={16}
            iconCreateFunction={clusterIcon}
        >
            {pins.map(p => (
                <Marker key={p.key} position={[p.lat, p.lng]} icon={pinIcon(p, pinTitle(p))} zIndexOffset={p.inRadius ? 200 : 0}>
                    <Popup className="plot-popup" minWidth={280} maxWidth={300}>
                        <BuildingCard pin={p} />
                    </Popup>
                </Marker>
            ))}
        </MarkerClusterGroup>
    );
}
