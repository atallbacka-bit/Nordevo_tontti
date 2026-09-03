// Static map images for the plot deck, composited server-side with sharp:
// Carto light raster tiles (same basemap family as the site map) + an SVG
// overlay for parcel boundary, markers, amenities and attribution.
// All outputs are PNG buffers at 2x for print-sharp slides.

import sharp from 'sharp';
import { H } from './style';

// Carto's free basemaps went API-key-only (Aug 2026), so the deck now draws
// on keyless sources: OSM standard for street maps, Esri World_Imagery for
// aerials (the parcel hero and the cover's darkened night panel). Both serve
// 256px tiles only, so tiles are fetched at zoom+1 straight into the 2x
// canvas — same geography, true retina sharpness.
export type TileStyle = 'streets' | 'aerial';
const TILE_URL = (z: number, x: number, y: number, style: TileStyle) =>
    style === 'aerial'
        ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
        : `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const g = globalThis as any;
if (!g.__deckTileCache) g.__deckTileCache = new Map<string, Buffer>();
const tileCache: Map<string, Buffer> = g.__deckTileCache;

async function fetchTile(z: number, x: number, y: number, style: TileStyle): Promise<Buffer | null> {
    const max = 2 ** z;
    if (y < 0 || y >= max) return null;
    const wx = ((x % max) + max) % max;
    const key = `${style}/${z}/${wx}/${y}`;
    const hit = tileCache.get(key);
    if (hit) return hit;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (attempt > 0) await new Promise(r => setTimeout(r, 350 * attempt));
            const res = await fetch(TILE_URL(z, wx, y, style), {
                headers: { 'User-Agent': 'tonttihaku-deck/1.0 (internal tool)' },
            });
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            if (tileCache.size > 600) tileCache.clear();
            tileCache.set(key, buf);
            return buf;
        } catch { /* retry */ }
    }
    return null;
}

// ── Web-mercator math (css px, 256px tiles) ─────────────────
function worldPx(lat: number, lng: number, zoom: number): { x: number; y: number } {
    const size = 256 * 2 ** zoom;
    const x = ((lng + 180) / 360) * size;
    const s = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size;
    return { x, y };
}

export interface MapView {
    lat: number; lng: number; zoom: number;
    width: number; height: number; // css px; output is 2x
    style?: TileStyle;
    attribution?: boolean; // default true; disable for tiny insets whose parent map carries the credit
}

export type Project = (lat: number, lng: number) => { x: number; y: number }; // retina px

/** Zoom that fits a bbox into width×height css px with padding, clamped. */
export function zoomForBbox(
    minLat: number, minLng: number, maxLat: number, maxLng: number,
    width: number, height: number, pad = 0.72, minZ = 8, maxZ = 17,
): number {
    for (let z = maxZ; z >= minZ; z--) {
        const a = worldPx(maxLat, minLng, z);
        const b = worldPx(minLat, maxLng, z);
        if (Math.abs(b.x - a.x) <= width * pad && Math.abs(b.y - a.y) <= height * pad) return z;
    }
    return minZ;
}

export async function renderMap(
    view: MapView,
    overlay?: (p: Project, W: number, HH: number) => string,
): Promise<Buffer> {
    const { width, height, zoom } = view;
    const style: TileStyle = view.style ?? 'streets';
    // Retina: world px at zoom+1 equal output px on the 2x canvas exactly.
    const zR = zoom + 1;
    const W = width * 2, HH = height * 2;
    const c = worldPx(view.lat, view.lng, zR);
    const left = c.x - W / 2;
    const top = c.y - HH / 2;

    const tx0 = Math.floor(left / 256), tx1 = Math.floor((left + W) / 256);
    const ty0 = Math.floor(top / 256), ty1 = Math.floor((top + HH) / 256);

    // sharp can't clip composites that overflow the canvas, so build the full
    // tile mosaic first, then extract the viewport from it.
    const jobs: Promise<{ input: Buffer; left: number; top: number } | null>[] = [];
    for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
            jobs.push(fetchTile(zR, tx, ty, style).then(buf => buf ? {
                input: buf,
                left: (tx - tx0) * 256,
                top: (ty - ty0) * 256,
            } : null));
        }
    }
    const tiles = (await Promise.all(jobs)).filter(Boolean) as { input: Buffer; left: number; top: number }[];

    const mosaicW = (tx1 - tx0 + 1) * 256, mosaicH = (ty1 - ty0 + 1) * 256;
    const mosaic = await sharp({ create: { width: mosaicW, height: mosaicH, channels: 3, background: style === 'aerial' ? '#1a1a18' : '#e8e4dc' } })
        .composite(tiles)
        .png()
        .toBuffer();

    const cropLeft = Math.max(0, Math.round(left - tx0 * 256));
    const cropTop = Math.max(0, Math.round(top - ty0 * 256));

    const project: Project = (lat, lng) => {
        const p = worldPx(lat, lng, zR);
        return { x: p.x - left, y: p.y - top };
    };

    const credit = style === 'aerial' ? '© Esri · Maxar, Earthstar Geographics' : '© OpenStreetMap';
    const creditColor = style === 'aerial' ? '#D8D2C4' : '#5A5142';
    const attribution = view.attribution === false ? '' : `<text x="${W - 10}" y="${HH - 10}" text-anchor="end" font-family="Helvetica, Arial" font-size="15" fill="${creditColor}" opacity="0.9">${credit}</text>`;
    const svg = `<svg width="${W}" height="${HH}" xmlns="http://www.w3.org/2000/svg">${overlay ? overlay(project, W, HH) : ''}${attribution}</svg>`;

    return sharp(mosaic)
        .extract({ left: cropLeft, top: cropTop, width: Math.min(W, mosaicW - cropLeft), height: Math.min(HH, mosaicH - cropTop) })
        .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
        .png()
        .toBuffer();
}

// ── Overlay helpers ─────────────────────────────────────────

export interface PolyOpts {
    sw?: number;          // main stroke width (2x px)
    casing?: string;      // halo color under the stroke; '' disables
    casingW?: number;
}

/** Parcel boundary drawn with a light casing halo so it stays visible on any basemap. */
export function svgPolygon(rings: number[][][], p: Project, stroke: string, fill: string, opts: PolyOpts = {}): string {
    // rings: GeoJSON [ [ [lng,lat], ... ] ] — outer ring(s)
    const sw = opts.sw ?? 9;
    const casing = opts.casing ?? '#FFFFFF';
    const casingW = opts.casingW ?? sw * 2;
    const d = rings.map(ring =>
        'M' + ring.map(([lng, lat]) => { const q = p(lat, lng); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join('L') + 'Z'
    ).join(' ');
    let s = '';
    if (fill && fill !== 'none') s += `<path d="${d}" fill="${fill}" stroke="none"/>`;
    if (casing) s += `<path d="${d}" fill="none" stroke="${casing}" stroke-width="${casingW}" stroke-linejoin="round" stroke-opacity="0.92"/>`;
    s += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    return s;
}

export function svgMarker(lat: number, lng: number, p: Project, color = H.orange, r = 15): string {
    const q = p(lat, lng);
    return `<circle cx="${q.x}" cy="${q.y}" r="${r + 9}" fill="${color}" opacity="0.22"/>`
        + `<circle cx="${q.x}" cy="${q.y}" r="${r}" fill="${color}" stroke="#FFFFFF" stroke-width="4"/>`;
}

export function svgDot(lat: number, lng: number, p: Project, color: string, r = 8): string {
    const q = p(lat, lng);
    return `<circle cx="${q.x}" cy="${q.y}" r="${r}" fill="${color}" stroke="#FFFFFF" stroke-width="2.5"/>`;
}

/** Geometry → flat list of outer+hole rings usable by svgPolygon. */
export function geometryRings(geom: any): number[][][] {
    if (!geom) return [];
    if (geom.type === 'Polygon') return geom.coordinates;
    if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
    return [];
}

export function geometryBbox(geom: any): { minLat: number; minLng: number; maxLat: number; maxLng: number } | null {
    const rings = geometryRings(geom);
    if (!rings.length) return null;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const ring of rings) for (const [lng, lat] of ring) {
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    }
    return { minLat, minLng, maxLat, maxLng };
}

// ── Asemakaava extract (Helsinki open WMS; other cities: null) ──

export async function renderAsemakaava(
    lat: number, lng: number, kunta: string | undefined,
    parcelGeom: any | null,
    width = 760, height = 560,
): Promise<Buffer | null> {
    if (!kunta || !/helsinki/i.test(kunta)) return null;
    // Tight crop: the extract must stay readable (kaavamerkinnät, floor-count
    // numerals), so frame the parcel itself plus a little context — not the
    // whole block. Window in metres, aspect locked to the output image.
    const AR = width / height;
    const mPerLat = 110574;
    const mPerLng = 111320 * Math.cos((lat * Math.PI) / 180);
    let Wm = 200 * AR, Hm = 200; // default ~270 × 200 m
    const pb = parcelGeom ? geometryBbox(parcelGeom) : null;
    if (pb) {
        const bw = (pb.maxLng - pb.minLng) * mPerLng;
        const bh = (pb.maxLat - pb.minLat) * mPerLat;
        Wm = Math.max(150 * AR, bw * 1.6, bh * 1.6 * AR);
        Hm = Wm / AR;
    }
    const cLat = pb ? (pb.minLat + pb.maxLat) / 2 : lat;
    const cLng = pb ? (pb.minLng + pb.maxLng) / 2 : lng;
    const dLat = Hm / 2 / mPerLat;
    const dLng = Wm / 2 / mPerLng;
    const bbox = [cLng - dLng, cLat - dLat, cLng + dLng, cLat + dLat];
    const url = 'https://kartta.hel.fi/ws/geoserver/avoindata/wms'
        + '?service=WMS&version=1.1.1&request=GetMap'
        + '&layers=avoindata:Ajantasa_asemakaava_maanpaallinen_varillinen'
        + `&styles=&srs=EPSG:4326&bbox=${bbox.join(',')}`
        + `&width=${width * 2}&height=${height * 2}&format=image/png`;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 2000) return null; // blank/error tile

        const W = width * 2, HH = height * 2;
        const project: Project = (la, ln) => ({
            x: ((ln - bbox[0]) / (bbox[2] - bbox[0])) * W,
            y: ((bbox[3] - la) / (bbox[3] - bbox[1])) * HH,
        });
        let over = '';
        const rings = geometryRings(parcelGeom);
        if (rings.length) over += svgPolygon(rings, project, H.orange, 'none', { sw: 8, casingW: 18 });
        else over += svgMarker(lat, lng, project);
        over += `<text x="${W - 10}" y="${HH - 10}" text-anchor="end" font-family="Helvetica, Arial" font-size="15" fill="#5A5142">© Helsingin kaupunki, ajantasa-asemakaava</text>`;
        const svg = `<svg width="${W}" height="${HH}" xmlns="http://www.w3.org/2000/svg">${over}</svg>`;
        return await sharp(buf).flatten({ background: '#ffffff' })
            .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
            .png().toBuffer();
    } catch {
        return null;
    }
}
