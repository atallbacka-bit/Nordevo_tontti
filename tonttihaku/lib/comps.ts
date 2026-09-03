// Oikotie comparables shared by the market analysis panel and its map overlay.
// The API route (app/api/market/comps) produces these; the panel medians and
// the map pins bucket them by building age with ONE definition here, so a pin
// on the map always belongs to the same bucket as the number in the panel.

export interface CompListing {
    id: number; url: string; address: string; district: string;
    year: number | null; buildingType: number | null; newDev: boolean;
    rooms: number | null; roomConfig: string;
    sizeM2: number; price: number; eurM2: number;   // rent: €/kk and €/m²/kk
    lat: number | null; lng: number | null; postcode: string;
    daysOnMarket: number | null; bumped: boolean; priceCut: boolean;
    visits: number | null; visitsWeekly: number | null;
}

export interface CompsResponse {
    postcodes: string[]; sale: CompListing[]; rent: CompListing[];
    saleFound?: number; rentFound?: number; fetchedAt: string; error?: string;
}

export type AgeBucket = 'uudet' | 'uudehkot' | 'vanhat';

/** Sale listings: 'uudet' = marketed as uudiskohde or completed within a year. */
export function isSaleNew(l: CompListing, nowYear = new Date().getFullYear()): boolean {
    return l.newDev || (l.year != null && l.year >= nowYear - 1);
}

/** Rental listings: 'uudet' = uudiskohde or completed within five years — a
 *  new-build rent stays a new-build rent for a few years after completion. */
export function isRentNew(l: CompListing, nowYear = new Date().getFullYear()): boolean {
    return l.newDev || (l.year != null && l.year >= nowYear - 5);
}

/** Exclusive rent buckets: uudet → 2010-luku → vanhat. An unknown year counts
 *  as old stock (Oikotie leaves the year blank mostly on older buildings). */
export function rentBucket(l: CompListing, nowYear = new Date().getFullYear()): AgeBucket {
    if (isRentNew(l, nowYear)) return 'uudet';
    if (l.year != null && l.year >= 2010) return 'uudehkot';
    return 'vanhat';
}

// Map tag colours (CompsMapLayer). The panel's Kartalla chips use the same
// values so the chips double as the map legend. Rent = teal, sale = indigo —
// neither is used by the STH pills (blue/amber pastel) or the plot pills.
export const COMPS_TAG = {
    rentText: '#0f766e',
    rentSpine: { uudet: '#0f766e', uudehkot: '#5eead4', vanhat: '#94a3b8' } as Record<AgeBucket, string>,
    saleText: '#4338ca',
    saleSpine: '#4f46e5',
};

export const AGE_BUCKET_LABEL: Record<AgeBucket, string> = {
    uudet: 'Uudet',
    uudehkot: '2010-luku',
    vanhat: 'Vanhat',
};
