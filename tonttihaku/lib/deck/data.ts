// Collects everything the deck needs for one plot. Market data comes through
// the SAME internal API routes the panel uses (comps/resale/property), so
// caching and source quirks live in exactly one place.

import { getSupabaseAdmin } from '@/lib/supabase';
import { PlotData, ZoningEntry } from '@/types';
import { parseZonings } from '@/lib/plotUtils';
import { buildDataset, SthDataset, DbSalesRow, formatSnapshot, haversineKm } from '@/lib/sthAnalysis';
import { nearbyPostalCodes, railAccess, amenityCounts, RailAccess, AmenityCounts, PostalAreaFC, RailStation, Amenity } from '@/lib/marketData';
import { ResaleResponse } from '@/lib/resaleAnalysis';
import { loadPostalAreasFs, loadRailStationsFs, loadAmenitiesFs } from './serverGeo';
import { computeDeckMarket, DeckMarket, CompsResponseLite } from './market';
import { travelTable, TravelRow } from './travel';

export interface ParcelData {
    tunnus: string;
    areaM2: number | null;
    geometry: any | null;
}

export interface DeckData {
    plot: PlotData;
    zonings: ZoningEntry[];
    dataset: SthDataset;
    snapshotLabel: string;
    market: DeckMarket;
    parcel: ParcelData | null;
    postalFC: PostalAreaFC;
    rail: RailStation[];
    amenities: Amenity[];
    access: RailAccess;
    amen: AmenityCounts;
    travel: TravelRow[];
    radiusKm: number;
    compsSaleN: number;
    plansNearby: number | null;
}

type InternalFetch = (path: string) => Promise<any | null>;

export async function collectDeckData(
    plotId: string,
    fetchInternal: InternalFetch,
    radiusKm: number,
): Promise<DeckData> {
    const supabase = getSupabaseAdmin();

    const [plotRes, sthRes, postalFC, rail, amenities] = await Promise.all([
        supabase.from('plots').select('*').eq('id', plotId).single(),
        supabase.from('sales_analysis_data').select('*').limit(5000),
        loadPostalAreasFs(),
        loadRailStationsFs(),
        loadAmenitiesFs(),
    ]);

    if (plotRes.error || !plotRes.data) throw new Error(`Plot ${plotId} not found`);
    const { Wood, ...plotRow } = plotRes.data as any;
    const plot = plotRow as PlotData;
    if (!isFinite(plot.lat) || !isFinite(plot.lng)) throw new Error('Plot has no coordinates');

    const dataset = buildDataset((sthRes.data || []) as DbSalesRow[]);

    const codes = nearbyPostalCodes(plot.lat, plot.lng, postalFC, Math.max(1.2, radiusKm), 4);
    const codesQ = codes.join(',');

    const [comps, resale, parcelRaw, plans, travel] = await Promise.all([
        codes.length ? fetchInternal(`/api/market/comps?postcodes=${codesQ}`) as Promise<CompsResponseLite | null> : Promise.resolve(null),
        codes.length ? fetchInternal(`/api/market/resale?postcodes=${codesQ}`) as Promise<ResaleResponse | null> : Promise.resolve(null),
        fetchInternal(`/api/market/property?lat=${plot.lat}&lon=${plot.lng}`),
        fetchInternal('/api/market/plans'),
        travelTable(plot.lat, plot.lng, plot.kunta, rail),
    ]);

    const market = computeDeckMarket(plot.lat, plot.lng, radiusKm, dataset, comps, resale, postalFC);

    const parcelObj = parcelRaw?.parcel ?? parcelRaw;
    const parcel: ParcelData | null = parcelObj?.tunnus
        ? { tunnus: parcelObj.tunnus, areaM2: parcelObj.areaM2 ?? null, geometry: parcelObj.geometry ?? null }
        : null;

    // kaavat vireillä near the plot (count only; the map shows where)
    let plansNearby: number | null = null;
    if (plans?.features) {
        plansNearby = 0;
        for (const f of plans.features) {
            try {
                const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
                let sx = 0, sy = 0;
                for (const [x, y] of ring) { sx += x; sy += y; }
                const cx = sx / ring.length, cy = sy / ring.length;
                if (haversineKm(plot.lat, plot.lng, cy, cx) <= radiusKm + 0.3) plansNearby++;
            } catch { /* skip malformed */ }
        }
    }

    return {
        plot,
        zonings: parseZonings(plot),
        dataset,
        snapshotLabel: dataset.snapshot ? formatSnapshot(dataset.snapshot) : '–',
        market,
        parcel,
        postalFC, rail, amenities,
        access: railAccess(plot.lat, plot.lng, rail),
        amen: amenityCounts(plot.lat, plot.lng, amenities, 1.0),
        travel,
        radiusKm,
        compsSaleN: comps?.sale?.length ?? 0,
        plansNearby,
    };
}
