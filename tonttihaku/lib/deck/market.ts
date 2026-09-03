// Server-side mirror of MarketAnalysisPanel's derived values for the deck.
// KEEP IN SYNC with components/MarketAnalysisPanel.tsx (the verdict block,
// liquid band, premium and sell-out logic) — the deck must say the same thing
// as the panel for the same point.

import {
    SthDataset, PointAnalysis, analyzePoint, computeAreaStats, compareMoversStalled,
    formatMonthsInv, fmtEur, haversineKm, reasonText,
} from '@/lib/sthAnalysis';
import {
    poolResale, resaleLiquidity, bandLiquidity, liquidPriceBand, gradeResale,
    ResaleResponse, PooledResale, LiquidBand,
} from '@/lib/resaleAnalysis';
import { findPostalArea, PostalAreaFC, PostalAreaFeature } from '@/lib/marketData';
import { POSTAL_INFO } from '@/lib/postalInfo';

export interface CompListingLite {
    id: number; address: string; postcode: string;
    year: number | null; buildingType: number | null; newDev: boolean;
    rooms: number | null; sizeM2: number; price: number; eurM2: number;
    lat: number | null; lng: number | null;
    daysOnMarket: number | null; bumped: boolean; priceCut: boolean;
}
export interface CompsResponseLite {
    postcodes: string[]; sale: CompListingLite[]; rent: CompListingLite[];
    saleFound?: number; fetchedAt: string;
}

export type Tone = 'pos' | 'neu' | 'neg';
export interface VerdictLine { tone: Tone; text: string }

function median(vals: number[]): number | null {
    const v = vals.filter(x => isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export interface DeckMarket {
    analysis: PointAnalysis;
    sthThin: boolean;
    area: PostalAreaFeature | null;
    areaInfo: string | undefined;
    resalePooled: PooledResale | null;
    resaleLiq: ReturnType<typeof resaleLiquidity> | null;
    resaleGrade: ReturnType<typeof gradeResale> | null;
    compStats: {
        uudet: { med: number | null; n: number };
        uudehkot: { med: number | null; n: number };
        vanhat: { med: number | null; n: number };
        saleN: number;
    } | null;
    plotEstimate: { value: number; source: string } | null;
    omaEquivClearing: { value: number; est: boolean } | null;
    premium: number | null;
    premiumVsRealized: boolean;
    liquidBand: LiquidBand | null;
    areaVerdict: { label: string; basis: string; source: 'uudis' | 'vanha' } | null;
    topGap: { type: string; gap: number } | null;
    topProduct: PointAnalysis['products'][number] | null;
    infillBuild: { label: string; basis: string } | null;
    sellout: number | null;
    unitCount: number;
    verdict: VerdictLine[];
    cmpReasons: string[];
    ladder: { label: string; value: number; emph?: 'accent' | 'muted' }[];
}

export function computeDeckMarket(
    lat: number, lng: number, radiusKm: number,
    dataset: SthDataset,
    comps: CompsResponseLite | null,
    resale: ResaleResponse | null,
    postalFC: PostalAreaFC | null,
    unitCount = 24,
): DeckMarket {
    const a = analyzePoint(lat, lng, radiusKm, dataset.projects);
    const st = a.stats;
    const area = postalFC ? findPostalArea(lat, lng, postalFC) : null;
    const areaStats = computeAreaStats(dataset.projects);
    const hot = area ? (areaStats.get(area.properties.code)?.hotness ?? null) : null;
    const clearingOma = a.clearingPrice.oma;

    // plot value estimate for leasehold → owned-plot conversion
    const landCostsNear = (maxKm: number) => dataset.projects
        .filter(p => p.tenure !== 'oma' && p.landCost != null && p.landCost > 0
            && haversineKm(lat, lng, p.lat, p.lng) <= maxKm)
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
    const omaEquivClearing = clearingOma
        ? { value: clearingOma.value, est: false }
        : a.clearingPrice.vuokra && plotEstimate
            ? { value: a.clearingPrice.vuokra.value + plotEstimate.value, est: true }
            : null;

    // comps buckets in radius (same +0.6 km slack as the panel)
    const inRadius = (l: CompListingLite) =>
        l.lat == null || l.lng == null || haversineKm(lat, lng, l.lat, l.lng) <= radiusKm + 0.6;
    const sale = comps ? comps.sale.filter(inRadius) : [];
    const nowYear = new Date().getFullYear();
    const uudetL = sale.filter(l => l.newDev || (l.year != null && l.year >= nowYear - 1));
    const uudehkotL = sale.filter(l => !uudetL.includes(l) && l.year != null && l.year >= 2010);
    const vanhatL = sale.filter(l => l.year != null && l.year < 2010);
    const compStats = comps ? {
        uudet: { med: median(uudetL.map(l => l.eurM2)), n: uudetL.length },
        uudehkot: { med: median(uudehkotL.map(l => l.eurM2)), n: uudehkotL.length },
        vanhat: { med: median(vanhatL.map(l => l.eurM2)), n: vanhatL.length },
        saleN: sale.length,
    } : null;

    // resale pooling + liquidity, postal frame
    const resalePooled = resale?.areas?.length ? poolResale(resale.areas) : null;
    const pooledCodeSet = new Set(resalePooled?.postcodes ?? []);
    const ktDwellings = postalFC && pooledCodeSet.size
        ? postalFC.features
            .filter(f => pooledCodeSet.has(f.properties.code))
            .reduce((acc, f) => f.properties.dwellings != null && f.properties.ktShare != null
                ? (acc ?? 0) + f.properties.dwellings * f.properties.ktShare : acc, null as number | null)
        : null;
    const resaleLiq = comps || resalePooled
        ? resaleLiquidity(comps?.sale ?? [], comps?.saleFound ?? 0, resalePooled, ktDwellings)
        : null;
    const resaleGrade = resaleLiq ? gradeResale(resaleLiq) : null;
    const fastestBand = comps
        ? bandLiquidity(comps.sale).filter(b => b.n >= 4 && b.domMedian != null)
            .sort((x, y) => x.domMedian! - y.domMedian!)[0] || null
        : null;

    // premium over the old stock
    const premiumBase = resalePooled?.ktEurM2 ?? compStats?.vanhat.med ?? null;
    const premiumVsRealized = resalePooled?.ktEurM2 != null;
    const premium = omaEquivClearing && premiumBase ? omaEquivClearing.value / premiumBase - 1 : null;

    // liquid band
    const radiusProjects = a.nearby.map(x => x.project);
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

    // "Myykö alue?"
    const sthThin = st.projects < 3;
    let areaVerdict: DeckMarket['areaVerdict'] = null;
    {
        const mi = st.monthsInventory;
        const kauppaa = `${st.sold12.toFixed(0)} uudiskauppa${Math.round(st.sold12) === 1 ? '' : 'a'} 12 kk`;
        if (!sthThin) {
            if (mi != null && mi <= 10 && st.sold12 >= 8) {
                areaVerdict = { label: 'Kyllä', basis: `${kauppaa} · varasto ${formatMonthsInv(mi)} kk`, source: 'uudis' };
            } else if (mi != null && mi <= 18) {
                areaVerdict = { label: 'Kohtalaisesti', basis: `${kauppaa} · varasto ${formatMonthsInv(mi)} kk`, source: 'uudis' };
            } else {
                areaVerdict = { label: 'Heikosti', basis: mi == null ? `${st.forSale.toFixed(0)} as. myynnissä, ei kauppoja 12 kk` : `varasto riittäisi ${formatMonthsInv(mi)} kk`, source: 'uudis' };
            }
        } else if (resaleGrade && resaleLiq && resalePooled) {
            const miTxt = resaleLiq.monthsInventory != null ? ` · varasto ≈ ${formatMonthsInv(resaleLiq.monthsInventory)} kk (KT)` : '';
            const basis = `Vanha kanta: ${resalePooled.sales12mo} kauppaa 12 kk${miTxt}`;
            if (resaleGrade === 'vilkas' || resaleGrade === 'normaali') {
                areaVerdict = { label: resaleGrade === 'vilkas' ? 'Kyllä' : 'Kyllä, maltilla', basis, source: 'vanha' };
            } else {
                areaVerdict = { label: resaleGrade === 'hidas' ? 'Vaimeasti' : 'Heikosti', basis, source: 'vanha' };
            }
        }
    }

    const topGapFull = a.mixGap
        .filter(m => m.gap > 0.08 && m.sold + m.unsold >= 10)
        .sort((x, y) => y.gap - x.gap)[0] || null;
    const topGap = topGapFull ? { type: topGapFull.type, gap: topGapFull.gap } : null;

    const ap = area?.properties as any;
    const infillBuild = sthThin && (fastestBand || ap?.ktShare != null)
        ? {
            label: `${ap?.ktShare != null && ap.ktShare < 0.45 ? 'Rivitalo / pientalo' : 'Kerrostalo'}${fastestBand ? `, ${fastestBand.id} m²` : ''}`,
            basis: fastestBand ? `${fastestBand.id} m² viipyy myynnissä lyhimpään` : 'alueen asuntokannan rakenne',
        }
        : null;

    const topProduct = st.projects > 0 ? a.products[0] || null : null;
    const sellout = topProduct && topProduct.sold12 > 0
        ? Math.round(12 * (unitCount + topProduct.forSale) / topProduct.sold12)
        : null;

    const cmp = compareMoversStalled(radiusProjects);
    const whiteSpace = hot != null && hot >= 65 && st.sold12 >= 10 && st.pipelineUnits < Math.max(10, st.sold12 / 2);

    // asking vs realized (for one verdict line)
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

    // verdict sentences — same rules as the panel
    const verdict: VerdictLine[] = [];
    {
        const mi = st.monthsInventory;
        if (st.projects === 0) {
            verdict.push({ tone: 'neu', text: 'Säteellä ei ole STH-seurattuja uudiskohteita — analyysi nojaa vanhan kannan kauppaan.' });
        } else if (sthThin) {
            verdict.push({ tone: 'neu', text: `Vain ${st.projects} uudiskohde${st.projects > 1 ? 'tta' : ''} säteellä — uudisnäyttö on ohut, vanhan kannan kauppa painaa arviossa.` });
        } else if (mi == null) {
            verdict.push({ tone: 'neg', text: `Uudiskauppa on jäässä: ${st.forSale.toFixed(0)} asuntoa myynnissä eikä yhtään kauppaa 12 kuukauteen.` });
        } else if (mi <= 8) {
            verdict.push({ tone: 'pos', text: `Kysyntä vetää: ${st.sold12.toFixed(0)} kauppaa 12 kk:ssa ja varasto kiertäisi ${formatMonthsInv(mi)} kuukaudessa.` });
        } else if (mi <= 18) {
            verdict.push({ tone: 'neu', text: `Kauppa käy kohtuullisesti: ${st.sold12.toFixed(0)} kauppaa 12 kk:ssa, varastoa ${formatMonthsInv(mi)} kuukaudeksi.` });
        } else {
            verdict.push({ tone: 'neg', text: `Tarjontaa on kysyntään nähden paljon: nykyvarasto riittäisi ${formatMonthsInv(mi)} kuukaudeksi.` });
        }
        if (resalePooled && resaleLiq) {
            if (sthThin) {
                const tone: Tone = resaleGrade === 'vilkas' || resaleGrade === 'normaali' ? 'pos' : resaleGrade === 'hidas' ? 'neu' : 'neg';
                verdict.push({
                    tone,
                    text: `Vanha kanta ${resaleGrade === 'vilkas' ? 'vaihtaa omistajaa vilkkaasti' : resaleGrade === 'normaali' ? 'käy normaalisti kaupaksi' : resaleGrade === 'hidas' ? 'liikkuu verkkaisesti' : 'ei juuri liiku'}: ${resalePooled.sales12mo} toteutunutta kauppaa 12 kk${resaleLiq.domMedian != null ? `, myynnissä olevat ilmoitukset md ${Math.round(resaleLiq.domMedian)} vrk vanhoja` : ''}.`,
                });
            } else if (resaleGrade === 'jaassa' || resaleGrade === 'hidas') {
                verdict.push({ tone: 'neg', text: `Myös vanha kanta liikkuu hitaasti (${resalePooled.sales12mo} kauppaa 12 kk${resaleLiq.domMedian != null ? `, ilmoitukset md ${Math.round(resaleLiq.domMedian)} vrk vanhoja` : ''}).` });
            }
            if (sthThin && resalePooled.ktEurM2 != null) {
                verdict.push({
                    tone: 'neu',
                    text: `Toteutunut vanhan kerrostalokannan hinta n. ${fmtEur(resalePooled.ktEurM2)} €/m²${resalePooled.trendPct != null ? ` (${resalePooled.trendPct >= 0 ? '+' : ''}${resalePooled.trendPct.toFixed(1).replace('.', ',')} % / 12 kk)` : ''}${askVsRealized != null && askVsRealized > 0.12 ? ` — pyynnit ${Math.round(askVsRealized * 100)} % yli toteutuneiden` : ''}.`,
                });
            }
        }
        const top = a.products[0];
        if (top && !sthThin) {
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
            const conv = plotEstimate ? a.clearingPrice.vuokra.value + plotEstimate.value : null;
            verdict.push({
                tone: 'neu',
                text: `Kauppaava uudishinta vuokratontilla n. ${fmtEur(a.clearingPrice.vuokra.value)} €/m² (ilman tonttia${conv ? `; omistusvertailuna ≈ ${fmtEur(conv)} €/m²` : ''}).`,
            });
        }
        if (cmp && cmp.reasons.length > 0 && cmp.inverted) {
            verdict.push({ tone: 'neu', text: reasonText(cmp.reasons[0]) });
        }
        if (premium != null && premium > 0.55) {
            verdict.push({ tone: 'neg', text: `Uudispreemio vanhaan kantaan +${Math.round(premium * 100)} % (vs. ${premiumVsRealized ? 'toteutuneet kaupat' : 'pyyntihinnat'}) — korkea preemio hidastaa myyntiä.` });
        }
        if (whiteSpace) {
            verdict.push({ tone: 'pos', text: `Valkoinen alue: kysyntä vetää, mutta tulevaa tarjontaa on vain ${st.pipelineUnits.toFixed(0)} asuntoa.` });
        } else if (st.projects > 0 && st.pipelineUnits > Math.max(20, st.sold12 * 1.5)) {
            verdict.push({ tone: 'neg', text: `Keskeneräisissä kohteissa ${st.pipelineUnits.toFixed(0)} myymätöntä asuntoa — tuleva tarjonta painaa markkinaa.` });
        }
    }

    // price ladder, owned-plot axis (subset of the panel's rungs)
    const ladder: DeckMarket['ladder'] = [];
    if (resalePooled?.ktEurM2) ladder.push({ label: 'Toteutunut vanha', value: resalePooled.ktEurM2, emph: 'muted' });
    if (compStats?.vanhat.med) ladder.push({ label: 'Vanhat pyynnit', value: compStats.vanhat.med, emph: 'muted' });
    if (compStats?.uudet.med) ladder.push({ label: 'Uudet pyynnit', value: compStats.uudet.med });
    if (clearingOma) ladder.push({ label: 'Kauppaava', value: clearingOma.value, emph: 'accent' });
    else if (a.clearingPrice.vuokra && plotEstimate) ladder.push({ label: 'Kauppaava*', value: a.clearingPrice.vuokra.value + plotEstimate.value, emph: 'accent' });
    if (a.stalledPrice.oma) ladder.push({ label: 'Seisova', value: a.stalledPrice.oma.value });
    else if (a.stalledPrice.vuokra && plotEstimate) ladder.push({ label: 'Seisova*', value: a.stalledPrice.vuokra.value + plotEstimate.value });

    return {
        analysis: a, sthThin, area, areaInfo: area ? POSTAL_INFO[area.properties.code] : undefined,
        resalePooled, resaleLiq, resaleGrade, compStats,
        plotEstimate, omaEquivClearing, premium, premiumVsRealized, liquidBand,
        areaVerdict, topGap, topProduct, infillBuild, sellout, unitCount,
        verdict, cmpReasons: (cmp?.reasons ?? []).map(reasonText), ladder,
    };
}
