import { NextRequest, NextResponse } from 'next/server';

// Oikotie comparables for the market analysis panel.
// GET /api/market/comps?postcodes=00640,00630
// Returns current sale + rental listings for the given postal codes, slimmed
// down to what the comps math needs. Everything is cached in-memory:
//   - the ota-* auth tokens are scraped from the listing page (~30 min TTL)
//   - postal code -> Oikotie location id lookups are kept for the process lifetime
//   - card results per postcode are kept for 6 h
// Keep request volume polite: one request per postcode per listing type.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TOKEN_TTL = 30 * 60 * 1000;
const CARDS_TTL = 6 * 60 * 60 * 1000;
const MAX_POSTCODES = 6;

interface OtaTokens { token: string; cuid: string; loaded: string; fetchedAt: number }

export interface CompListing {
    id: number;
    url: string;
    address: string;
    district: string;
    year: number | null;
    buildingType: number | null;
    newDev: boolean;
    rooms: number | null;
    roomConfig: string;
    sizeM2: number;
    price: number;        // sale: € (velaton myyntihinta as shown), rent: €/kk
    eurM2: number;        // sale: €/m², rent: €/m²/kk
    lat: number | null;
    lng: number | null;
    postcode: string;
    daysOnMarket: number | null;  // from published — survives bumps (publishedSort carries those)
    bumped: boolean;              // listing renewed/bumped since publish → long-running, still marketed
    priceCut: boolean;            // priceChanged set → asking has been changed (in practice: reduced)
    visits: number | null;        // cumulative listing page views
    visitsWeekly: number | null;  // views last week — current buyer interest
}

const g = globalThis as any;
if (!g.__oikotieCache) {
    g.__oikotieCache = {
        tokens: null as OtaTokens | null,
        locations: new Map<string, { cardId: number; name: string } | null>(),
        cards: new Map<string, { at: number; sale: CompListing[]; rent: CompListing[]; saleFound: number; rentFound: number }>(),
    };
}
const store = g.__oikotieCache;

async function getTokens(force = false): Promise<OtaTokens | null> {
    if (!force && store.tokens && Date.now() - store.tokens.fetchedAt < TOKEN_TTL) return store.tokens;
    try {
        const res = await fetch('https://asunnot.oikotie.fi/myytavat-asunnot', {
            headers: { 'User-Agent': UA }, cache: 'no-store',
        });
        const html = await res.text();
        const grab = (name: string) => html.match(new RegExp(`${name}"\\s+content="([^"]+)"`))?.[1];
        const token = grab('api-token');
        const cuid = grab('cuid');
        const loaded = grab('loaded');
        if (!token || !cuid || !loaded) return null;
        store.tokens = { token, cuid, loaded, fetchedAt: Date.now() };
        return store.tokens;
    } catch {
        return null;
    }
}

async function oikotieGet(path: string, tokens: OtaTokens): Promise<any | null> {
    try {
        const res = await fetch(`https://asunnot.oikotie.fi${path}`, {
            headers: {
                'User-Agent': UA,
                'ota-token': tokens.token,
                'ota-cuid': tokens.cuid,
                'ota-loaded': tokens.loaded,
            },
            cache: 'no-store',
        });
        if (res.status === 401 || res.status === 403) return { __auth: true };
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

// 'retry' = transient/auth failure — never cached, so one bad lookup can't
// permanently blank a postcode for the process lifetime
async function locationId(postcode: string, tokens: OtaTokens): Promise<{ cardId: number; name: string } | null | 'retry'> {
    if (store.locations.has(postcode)) return store.locations.get(postcode);
    const data = await oikotieGet(`/api/3.0/location?query=${postcode}`, tokens);
    if (!Array.isArray(data)) return 'retry';
    let loc: { cardId: number; name: string } | null = null;
    const hit = data.find((x: any) => x?.card?.cardType === 5 && x?.card?.name === postcode);
    if (hit) loc = { cardId: hit.card.cardId, name: `${postcode}, ${hit.parent?.name || ''}` };
    store.locations.set(postcode, loc);
    return loc;
}

function parsePrice(v: unknown): number | null {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return null;
    const cleaned = v.replace(/[^\d,\.]/g, '').replace(/\s/g, '');
    if (!cleaned) return null;
    const f = parseFloat(cleaned.replace(',', '.'));
    return isNaN(f) ? null : f;
}

function toListing(card: any, postcode: string, isRent: boolean): CompListing | null {
    const b = card?.buildingData || {};
    const size = typeof card?.size === 'number' ? card.size : parseFloat(card?.size);
    const price = parsePrice(card?.price);
    if (!size || !price || size < 10) return null;
    const eurM2 = price / size;
    // drop non-market sale prices (asumisoikeus / osaomistus listings)
    if (!isRent && eurM2 < 1800) return null;
    if (isRent && (eurM2 < 5 || eurM2 > 80)) return null;
    // days on market from the original publish date (verified: NOT reset when the
    // listing is bumped — publishedSort carries the bump). Relisting under a new
    // id is the only undetectable reset.
    let daysOnMarket: number | null = null;
    if (card.published) {
        const t = Date.parse(card.published);
        if (!isNaN(t)) daysOnMarket = Math.max(0, Math.round((Date.now() - t) / 86400000));
    }
    const bumped = !!(card.published && card.publishedSort
        && Date.parse(card.publishedSort) - Date.parse(card.published) > 86400000);
    return {
        id: card.id,
        url: card.url,
        address: b.address || '',
        district: b.district || '',
        year: b.year || null,
        buildingType: b.buildingType ?? null,
        newDev: !!card.newDevelopment,
        rooms: card.rooms ?? null,
        roomConfig: card.roomConfiguration || '',
        sizeM2: size,
        price,
        eurM2: Math.round(eurM2 * 10) / 10,
        lat: card?.coordinates?.latitude ?? null,
        lng: card?.coordinates?.longitude ?? null,
        postcode,
        daysOnMarket,
        bumped,
        priceCut: card.priceChanged != null,
        visits: typeof card.visits === 'number' ? card.visits : null,
        visitsWeekly: typeof card.visits_weekly === 'number' ? card.visits_weekly : null,
    };
}

interface PostcodeCards { sale: CompListing[]; rent: CompListing[]; saleFound: number; rentFound: number }

async function fetchPostcode(postcode: string, tokens: OtaTokens): Promise<PostcodeCards | null> {
    const cached = store.cards.get(postcode);
    if (cached && Date.now() - cached.at < CARDS_TTL) return cached;

    const loc = await locationId(postcode, tokens);
    if (loc === 'retry') return null; // transient/auth failure — let GET refresh tokens and retry
    if (!loc) return { sale: [], rent: [], saleFound: 0, rentFound: 0 };
    const locParam = encodeURIComponent(JSON.stringify([[loc.cardId, 5, loc.name]]));

    const out = { at: Date.now(), sale: [] as CompListing[], rent: [] as CompListing[], saleFound: 0, rentFound: 0 };
    for (const [cardType, key, foundKey] of [[100, 'sale', 'saleFound'], [101, 'rent', 'rentFound']] as const) {
        // limit=500: results sort by bump date desc, so a lower cap silently drops
        // the LONGEST-listed stock and flatters days-on-market stats
        const data = await oikotieGet(`/api/cards?cardType=${cardType}&limit=500&locations=${locParam}`, tokens);
        // any failure (auth, 429, network) → return null WITHOUT caching, so a
        // transient error isn't served as "no listings" for the next 6 hours
        if (data == null || data.__auth) return null;
        if (typeof data.found === 'number') out[foundKey] = data.found;
        const cards = data.cards;
        if (Array.isArray(cards)) {
            for (const c of cards) {
                const l = toListing(c, postcode, cardType === 101);
                if (l) out[key].push(l);
            }
        }
    }
    store.cards.set(postcode, out);
    return out;
}

export async function GET(req: NextRequest) {
    const raw = req.nextUrl.searchParams.get('postcodes') || '';
    const postcodes = raw.split(',').map(x => x.trim()).filter(x => /^\d{5}$/.test(x)).slice(0, MAX_POSTCODES);
    if (!postcodes.length) {
        return NextResponse.json({ error: 'postcodes parameter required (comma separated 5-digit codes)' }, { status: 400 });
    }

    let tokens = await getTokens();
    if (!tokens) return NextResponse.json({ error: 'Oikotie ei vastaa (token)' }, { status: 502 });

    const sale: CompListing[] = [];
    const rent: CompListing[] = [];
    let saleFound = 0, rentFound = 0;
    for (const pc of postcodes) {
        let res = await fetchPostcode(pc, tokens);
        if (res === null) {
            tokens = await getTokens(true);
            if (!tokens) break;
            res = await fetchPostcode(pc, tokens);
        }
        if (res) {
            sale.push(...res.sale);
            rent.push(...res.rent);
            saleFound += res.saleFound;
            rentFound += res.rentFound;
        }
    }

    // dedupe by listing id (a listing can match several postcode queries)
    const seen = new Set<number>();
    const dedupe = (arr: CompListing[]) => arr.filter(l => (seen.has(l.id) ? false : (seen.add(l.id), true)));

    return NextResponse.json({
        postcodes,
        sale: dedupe(sale),
        rent: dedupe(rent),
        saleFound,
        rentFound,
        fetchedAt: new Date().toISOString(),
    });
}
