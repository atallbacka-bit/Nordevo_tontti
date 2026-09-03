// Assembles the plot deck (.pptx) from collected data. Design system:
// warm paper ground, ink typography in system fonts (Helvetica Neue /
// Georgia), colored basemaps, orange reserved for the parcel and the few
// numbers that matter. Every content slide shares one grid: header rule,
// left column at x=0.62 (w 6.68), right column at x=7.72 (w 4.99), footer
// with wordmark + page number. Slides 1–3 carry raw data; 4–5 the read.

import pptxgen from 'pptxgenjs';
import sharp from 'sharp';
import { DeckData } from './data';
import { C, F, PAGE, fmtNum, fmtMEur, sanitize } from './style';
import {
    renderMap, renderAsemakaava, zoomForBbox, geometryRings, geometryBbox,
    svgPolygon, svgMarker, svgDot,
} from './maps';
import { mixChart, quarterChart, ladderChart } from './charts';
import { readBrandAsset } from './serverGeo';
import { formatMonthsInv, formatYm, fmtEur } from '@/lib/sthAnalysis';

type Slide = ReturnType<pptxgen['addSlide']>;

// ── grid ────────────────────────────────────────────────────
const M = PAGE.margin;               // 0.62
const RE = PAGE.w - M;               // 12.713 right edge
const CONTENT_W = PAGE.w - 2 * M;    // 12.093
const LX = M, LW = 6.68;             // canonical left column
const RX = 7.72, RW = RE - 7.72;     // canonical right column (4.99)
const Y0 = 1.56;                     // content top under the header rule
const FOOT_Y = 7.14;                 // footer baseline; content ends ≤ 7.0

function b64(buf: Buffer): string {
    return 'image/png;base64,' + buf.toString('base64');
}

// ── shared primitives ───────────────────────────────────────

function hairline(s: Slide, x: number, y: number, w: number, opts: { onDark?: boolean; strength?: number } = {}) {
    s.addShape('rect', {
        x, y, w, h: 0.012,
        fill: { color: opts.onDark ? C.cream : C.ink, transparency: opts.strength ?? (opts.onDark ? 72 : 84) },
        line: { color: opts.onDark ? C.cream : C.ink, transparency: 100, width: 0 },
    });
}

/** The one section-label style: 9.5pt caps, tracked out, warm grey. */
function label(s: Slide, text: string, x: number, y: number, w: number, opts: { align?: 'left' | 'right'; color?: string } = {}) {
    s.addText(text.toUpperCase(), {
        x, y, w, h: 0.26, fontFace: F.head, fontSize: 9.5, color: opts.color ?? C.greyLight,
        charSpacing: 1.8, bold: true, align: opts.align ?? 'left',
    });
}

/** The one caption style: 8.5pt Georgia, warm grey. */
function caption(s: Slide, text: string, x: number, y: number, w: number, h = 0.24) {
    s.addText(text, {
        x, y, w, h, fontFace: F.body, fontSize: 8.5, color: C.greyLight,
        lineSpacingMultiple: 1.15, valign: 'top',
    });
}

/** Soft cream card — the only "container" device in the deck. */
function card(s: Slide, x: number, y: number, w: number, h: number) {
    s.addShape('rect', {
        x, y, w, h,
        fill: { color: C.cream },
        line: { color: C.cream, transparency: 100, width: 0 },
    });
}

/** Slide header: kicker, 26pt title, optional right meta, full-width rule. */
function header(s: Slide, kicker: string, title: string, meta?: string) {
    s.addText(kicker.toUpperCase(), {
        x: M, y: 0.4, w: 6, h: 0.26, fontFace: F.head, fontSize: 9.5, color: C.greyLight,
        charSpacing: 1.8, bold: true,
    });
    s.addText(title, {
        x: M - 0.02, y: 0.62, w: 7.6, h: 0.56, fontFace: F.head, fontSize: 26, color: C.ink, bold: true,
    });
    if (meta) s.addText(meta, {
        x: 8.3, y: 0.74, w: RE - 8.3, h: 0.44, fontFace: F.body, fontSize: 9, color: C.greyLight,
        align: 'right', valign: 'top', lineSpacingMultiple: 1.2,
    });
    hairline(s, M, 1.3, CONTENT_W);
}

function footer(s: Slide, wordmarkInk: Buffer, page: number, total: number) {
    const wmW = 0.92;
    s.addImage({ data: b64(wordmarkInk), x: M, y: FOOT_Y, w: wmW, h: wmW / WORDMARK_AR });
    s.addText(`${page} / ${total}`, {
        x: RE - 1, y: FOOT_Y - 0.02, w: 1, h: 0.2, fontFace: F.body, fontSize: 8.5,
        color: C.greyLight, align: 'right',
    });
}

async function brandPng(file: string, color: string, heightPx: number): Promise<Buffer> {
    const raw = (await readBrandAsset(file)).toString('utf8');
    const svg = raw.replace(/#221c12/gi, color).replace(/#000000/g, color).replace(/fill="black"/g, `fill="${color}"`);
    return sharp(Buffer.from(svg)).resize({ height: heightPx }).png().toBuffer();
}

// wordmark aspect: 649 × 108 (viewBox with padding)
const WORDMARK_AR = 649 / 108;

// ── image builders ──────────────────────────────────────────

function svgLabelText(x: number, y: number, text: string, size: number, color: string, anchor: 'start' | 'end' = 'start', halo = '#FFFFFF'): string {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="'Helvetica Neue', Helvetica, Arial" font-weight="600" font-size="${size}" fill="${color}" stroke="${halo}" stroke-width="7" paint-order="stroke" stroke-linejoin="round">${esc}</text>`;
}

/** Plot names arrive with stray comma spacing ("Myllypuro , Kivensilmänkuja"). */
function cleanName(name: string): string {
    return (name || '').replace(/\s+,\s*/g, ', ').trim();
}

const HKI = { lat: 60.1699, lng: 24.9384 };

async function buildMapImages(d: DeckData) {
    const { plot } = d;
    const geom = d.parcel?.geometry ?? null;
    const rings = geometryRings(geom);
    const bbox = geom ? geometryBbox(geom) : null;

    // Hero: the parcel and its immediate surroundings, boundary unmissable
    const hw = 748, hh = 478;
    const heroCenter = bbox
        ? { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 }
        : { lat: plot.lat, lng: plot.lng };
    const zHero = bbox
        ? zoomForBbox(bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng, hw, hh, 0.5, 14, 18)
        : 16;
    const hero = await renderMap(
        { lat: heroCenter.lat, lng: heroCenter.lng, zoom: zHero, width: hw, height: hh, style: 'aerial' },
        (p) => {
            if (rings.length) return svgPolygon(rings, p, `#${C.orange}`, 'rgba(194,90,23,0.14)', { sw: 10, casingW: 22 });
            return svgMarker(plot.lat, plot.lng, p, `#${C.orange}`, 17);
        },
    );

    // Locator inset: where this is in the capital region
    const iw = 200, ih = 138;
    const ctxBox = {
        minLat: Math.min(plot.lat, HKI.lat), maxLat: Math.max(plot.lat, HKI.lat),
        minLng: Math.min(plot.lng, HKI.lng), maxLng: Math.max(plot.lng, HKI.lng),
    };
    const zCtx = zoomForBbox(ctxBox.minLat, ctxBox.minLng, ctxBox.maxLat, ctxBox.maxLng, iw, ih, 0.52, 7, 11);
    const locator = await renderMap(
        {
            lat: (ctxBox.minLat + ctxBox.maxLat) / 2, lng: (ctxBox.minLng + ctxBox.maxLng) / 2,
            zoom: zCtx, width: iw, height: ih, attribution: false,
        },
        (p) => {
            // the basemap labels Helsinki itself at these zooms; only mark the two points
            let s = '';
            const hq = p(HKI.lat, HKI.lng);
            s += `<circle cx="${hq.x}" cy="${hq.y}" r="6" fill="#${C.ink}" stroke="#FFFFFF" stroke-width="2.5"/>`;
            const pq = p(plot.lat, plot.lng);
            s += `<circle cx="${pq.x}" cy="${pq.y}" r="17" fill="#${C.orange}" opacity="0.25"/>`;
            s += `<circle cx="${pq.x}" cy="${pq.y}" r="10" fill="#${C.orange}" stroke="#FFFFFF" stroke-width="3.5"/>`;
            return s;
        },
    );

    // Services map
    const sw = 480, sh = 250;
    const services = await renderMap(
        { lat: plot.lat, lng: plot.lng, zoom: 14, width: sw, height: sh },
        (p, W, HH) => {
            let s = '';
            const near = (la: number, ln: number) => {
                const q = p(la, ln);
                return q.x > -20 && q.x < W + 20 && q.y > -20 && q.y < HH + 20;
            };
            for (const a of d.amenities) {
                if (!near(a.lat, a.lng)) continue;
                const col = a.t === 'kauppa' ? `#${C.ink}` : a.t === 'koulu' ? `#${C.spruce}` : `#${C.greyLight}`;
                s += svgDot(a.lat, a.lng, p, col, 8);
            }
            for (const r of d.rail) {
                if (!near(r.lat, r.lng) || r.uc) continue;
                const q = p(r.lat, r.lng);
                s += `<circle cx="${q.x}" cy="${q.y}" r="10" fill="#FFFFFF" stroke="#${C.ink}" stroke-width="4.5"/>`;
            }
            s += svgMarker(plot.lat, plot.lng, p, `#${C.orange}`, 13);
            return s;
        },
    );

    // Big services map for the non-Helsinki branch (no asemakaava available)
    const servicesBig = d.plot.kunta && /helsinki/i.test(d.plot.kunta) ? null : await renderMap(
        { lat: plot.lat, lng: plot.lng, zoom: 14, width: 642, height: 453 },
        (p, W, HH) => {
            let s = '';
            const near = (la: number, ln: number) => {
                const q = p(la, ln);
                return q.x > -20 && q.x < W + 20 && q.y > -20 && q.y < HH + 20;
            };
            for (const a of d.amenities) {
                if (!near(a.lat, a.lng)) continue;
                const col = a.t === 'kauppa' ? `#${C.ink}` : a.t === 'koulu' ? `#${C.spruce}` : `#${C.greyLight}`;
                s += svgDot(a.lat, a.lng, p, col, 8);
            }
            for (const r of d.rail) {
                if (!near(r.lat, r.lng) || r.uc) continue;
                const q = p(r.lat, r.lng);
                s += `<circle cx="${q.x}" cy="${q.y}" r="10" fill="#FFFFFF" stroke="#${C.ink}" stroke-width="4.5"/>`;
            }
            if (rings.length) s += svgPolygon(rings, p, `#${C.orange}`, 'rgba(194,90,23,0.14)', { sw: 8, casingW: 18 });
            s += svgMarker(plot.lat, plot.lng, p, `#${C.orange}`, 13);
            return s;
        },
    );

    // Cover panel: dark basemap fading into the cover ground
    const cw2 = 614, ch2 = 720;
    const zCover = bbox
        ? Math.max(15, Math.min(16, zoomForBbox(bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng, cw2, ch2, 0.34, 15, 16)))
        : 15;
    const cover = await renderMap(
        { lat: plot.lat, lng: plot.lng, zoom: zCover, width: cw2, height: ch2, style: 'aerial' },
        (p, W, HH) => {
            // night-mode veil over the daylight aerial, fading into the dark ground
            let s = '';
            s += `<rect x="0" y="0" width="${W}" height="${HH}" fill="#${C.dark}" opacity="0.55"/>`;
            s += `<defs><linearGradient id="fadeL" x1="0" y1="0" x2="1" y2="0">`
                + `<stop offset="0" stop-color="#${C.dark}" stop-opacity="1"/>`
                + `<stop offset="1" stop-color="#${C.dark}" stop-opacity="0"/>`
                + `</linearGradient></defs>`;
            s += `<rect x="0" y="0" width="${W * 0.55}" height="${HH}" fill="url(#fadeL)"/>`;
            if (rings.length) s += svgPolygon(rings, p, `#${C.orange}`, 'rgba(194,90,23,0.22)', { sw: 8, casingW: 16 });
            s += svgMarker(plot.lat, plot.lng, p, `#${C.orange}`, 14);
            return s;
        },
    );

    const asemakaava = await renderAsemakaava(plot.lat, plot.lng, plot.kunta, geom, 642, 453);

    return { hero, locator, services, servicesBig, cover, asemakaava };
}

// ── the deck ────────────────────────────────────────────────

export async function buildDeck(d: DeckData): Promise<Buffer> {
    const { plot, market: mk } = d;
    const a = mk.analysis;
    const st = a.stats;
    const TOTAL = 6;

    const [maps, wordmarkCream, wordmarkInk] = await Promise.all([
        buildMapImages(d),
        brandPng('nordevo-wordmark.svg', `#${C.cream}`, 160),
        brandPng('nordevo-wordmark.svg', `#${C.ink}`, 160),
    ]);

    const hasMix = a.mixGap.some(m => m.sold + m.unsold > 0);
    const mixImg = hasMix
        ? await mixChart(a.mixGap.map(m => ({ type: m.type, sold: m.sold, unsold: m.unsold })), 520, 345)
        : null;
    const quarters = mk.resalePooled?.quarters ?? null;
    const wideQuarters = !hasMix && !a.products.length;
    const quarterImg = quarters && quarters.length >= 2
        ? await quarterChart(quarters.slice(-8), wideQuarters ? 760 : 520, wideQuarters ? 275 : 345)
        : null;
    const ladderImg = mk.ladder.length >= 2 ? await ladderChart(mk.ladder, 760, 190) : null;

    const pres = new pptxgen();
    pres.defineLayout({ name: 'NORDEVO169', width: PAGE.w, height: PAGE.h });
    pres.layout = 'NORDEVO169';
    pres.author = 'Nordevo';
    pres.title = `Tonttianalyysi · ${cleanName(plot.name)}`;

    const verdictTone = (lbl: string) =>
        lbl.startsWith('Kyllä') ? C.pos : lbl === 'Kohtalaisesti' ? C.ink : C.neg;

    // ── Cover (dark, map panel right) ────────────────────────
    {
        const s = pres.addSlide();
        s.background = { color: C.dark };
        s.addImage({ data: b64(maps.cover), x: PAGE.w - 6.4, y: 0, w: 6.4, h: PAGE.h });

        const wmW = 2.35;
        s.addImage({ data: b64(wordmarkCream), x: M, y: 0.58, w: wmW, h: wmW / WORDMARK_AR });

        const name = cleanName(plot.name);
        // ~17 chars per line at 40pt bold in a 6.5" box
        const titleLines = Math.min(3, Math.max(1, Math.ceil(name.length / 17)));
        s.addText('TONTTIANALYYSI', {
            x: M, y: 2.6, w: 6, h: 0.28, fontFace: F.head, fontSize: 11, color: C.mint,
            charSpacing: 3, bold: true,
        });
        s.addText(name, {
            x: M - 0.03, y: 2.94, w: 6.5, h: titleLines * 0.62 + 0.16, fontFace: F.head, fontSize: 40,
            color: C.cream, bold: true, valign: 'top', lineSpacingMultiple: 1.02,
        });
        const sub = [plot.address, plot.kunta].filter(Boolean).join(' · ');
        if (sub) s.addText(sub, {
            x: M, y: 3.02 + titleLines * 0.62 + 0.18, w: 6.3, h: 0.36, fontFace: F.body, fontSize: 14, color: C.cream,
        });

        // key answers, so the deck communicates from page one
        const cells: { l: string; v: string }[] = [];
        if (mk.areaVerdict) cells.push({ l: 'Myykö alue', v: mk.areaVerdict.label });
        if (mk.liquidBand) cells.push({ l: 'Likvidi hinta', v: `${fmtNum(mk.liquidBand.lo)}–${fmtNum(mk.liquidBand.hi)} €/m²` });
        if (plot.buildingRight) cells.push({ l: 'Rakennusoikeus', v: `${fmtNum(plot.buildingRight)} k-m²` });
        if (cells.length) {
            hairline(s, M, 5.98, 6.55, { onDark: true });
            cells.forEach((c2, i) => {
                const x = M + i * 2.3;
                s.addText(c2.l.toUpperCase(), {
                    x, y: 6.22, w: 2.2, h: 0.24, fontFace: F.head, fontSize: 8.5, color: C.mint,
                    charSpacing: 1.6, bold: true,
                });
                s.addText(c2.v, {
                    x, y: 6.46, w: 2.24, h: 0.34, fontFace: F.head, fontSize: 14.5, color: C.cream, bold: true,
                });
            });
        }
    }

    // ── Slide 1 · Tontti ────────────────────────────────────
    {
        const s = pres.addSlide();
        s.background = { color: C.paper };
        header(s, 'Tontti', cleanName(plot.name), [plot.status, plot.kunta].filter(Boolean).join(' · '));

        const eurPerKm2 = plot.priceEst && plot.buildingRight ? plot.priceEst / plot.buildingRight : null;
        const rows: { k: string; v: string; bold?: boolean }[] = [];
        if (plot.address) rows.push({ k: 'Osoite', v: plot.address });
        const tunnus = d.parcel?.tunnus || plot.kiinteistotunnus;
        if (tunnus) rows.push({ k: 'Kiinteistötunnus', v: tunnus });
        if (plot.area) rows.push({ k: 'Pinta-ala', v: `${fmtNum(plot.area)} m²` });
        else if (d.parcel?.areaM2) rows.push({ k: 'Pinta-ala (MML)', v: `${fmtNum(d.parcel.areaM2)} m²` });
        if (plot.buildingRight) rows.push({ k: 'Rakennusoikeus', v: `${fmtNum(plot.buildingRight)} k-m²`, bold: true });
        if (d.zonings.length > 1 || (d.zonings[0] && d.zonings[0].type)) {
            rows.push({ k: 'Kaavamerkinnät', v: d.zonings.map(z => `${z.type} ${fmtNum(z.buildingRight)} k-m²`).join('\n') });
        }
        if (plot.priceEst) rows.push({ k: 'Hinta-arvio', v: fmtMEur(plot.priceEst), bold: true });
        if (eurPerKm2) rows.push({ k: 'Hinta / k-m²', v: `${fmtNum(Math.round(eurPerKm2))} €/k-m²` });
        if (plot.seller) rows.push({ k: 'Myyjä', v: plot.seller });
        if (plot.deadline) rows.push({ k: 'Määräaika', v: plot.deadline });

        const FX = M, FW = 3.92, FVX = M + 1.6, FVW = FX + FW - FVX;
        let y = Y0 + 0.06;
        for (const r of rows) {
            const twoLine = r.v.length > 24 || r.v.includes('\n');
            const rh = twoLine ? 0.64 : 0.42;
            s.addText(r.k.toUpperCase(), {
                x: FX, y: y + 0.02, w: 1.56, h: 0.28, fontFace: F.head, fontSize: 8, color: C.greyLight,
                charSpacing: 1, bold: true, valign: 'top',
            });
            s.addText(r.v, {
                x: FVX, y, w: FVW, h: rh - 0.08, fontFace: F.body, fontSize: 12, color: C.ink,
                bold: !!r.bold, valign: 'top', lineSpacingMultiple: 1.1,
            });
            y += rh;
            hairline(s, FX, y - 0.08, FW, { strength: 92 });
        }

        if (mk.areaInfo && y < 5.9) {
            label(s, 'Alue', FX, y + 0.18, FW);
            s.addText(sanitize(mk.areaInfo), {
                x: FX, y: y + 0.48, w: FW, h: Math.min(1.9, 6.95 - (y + 0.48)), fontFace: F.body, fontSize: 10,
                color: C.grey, lineSpacingMultiple: 1.3, valign: 'top',
            });
        }

        // hero: the parcel itself, boundary unmissable
        const HXX = 4.92, HW = RE - HXX, HH2 = 4.98;
        s.addImage({ data: b64(maps.hero), x: HXX, y: Y0, w: HW, h: HH2 });
        // locator inset, framed
        const inW = 2.05, inH = 1.42, inX = RE - 0.16 - inW, inY = Y0 + 0.16;
        s.addShape('rect', {
            x: inX - 0.045, y: inY - 0.045, w: inW + 0.09, h: inH + 0.09,
            fill: { color: 'FFFFFF' }, line: { color: C.ink, transparency: 75, width: 0.75 },
        });
        s.addImage({ data: b64(maps.locator), x: inX, y: inY, w: inW, h: inH });
        caption(s, d.parcel?.geometry
            ? 'Palstan rajaus oranssilla: Maanmittauslaitos. Yläkulmassa sijainti pääkaupunkiseudulla.'
            : 'Palstan rajausta ei ollut saatavilla tälle pisteelle. Yläkulmassa sijainti pääkaupunkiseudulla.',
            HXX, Y0 + HH2 + 0.08, HW);

        footer(s, wordmarkInk, 2, TOTAL);
    }

    // ── Slide 2 · Sijainti ja palvelut ──────────────────────
    {
        const s = pres.addSlide();
        s.background = { color: C.paper };
        header(s, 'Sijainti', 'Kaava, palvelut ja saavutettavuus',
            d.plansNearby != null && d.plansNearby > 0 ? `Vireillä ${d.plansNearby} asemakaavaa säteellä` : undefined);

        const legend = (x: number, yy: number, w: number) => s.addText([
            { text: '● ', options: { fontFace: F.body, fontSize: 10, color: C.ink } },
            { text: 'kauppa   ', options: { fontFace: F.body, fontSize: 10, color: C.grey } },
            { text: '● ', options: { fontFace: F.body, fontSize: 10, color: C.spruce } },
            { text: 'koulu   ', options: { fontFace: F.body, fontSize: 10, color: C.grey } },
            { text: '● ', options: { fontFace: F.body, fontSize: 10, color: C.greyLight } },
            { text: 'päiväkoti   ', options: { fontFace: F.body, fontSize: 10, color: C.grey } },
            { text: '○ ', options: { fontFace: F.body, fontSize: 10, color: C.ink } },
            { text: 'juna, metro tai ratikka', options: { fontFace: F.body, fontSize: 10, color: C.grey } },
        ], { x, y: yy, w, h: 0.26 });

        // travel table renderer, shared by both branches
        const travelBlock = (tx: number, tw: number, ty0: number) => {
            label(s, 'Matka-ajat', tx, ty0, tw);
            hairline(s, tx, ty0 + 0.3, tw);
            const colX = [tx, tx + tw - 2.62, tx + tw - 1.74, tx + tw - 0.86];
            const heads = ['', 'Kävellen', 'Joukkoliik.', 'Autolla'];
            heads.forEach((h2, i) => {
                if (h2) s.addText(h2.toUpperCase(), {
                    x: colX[i] - 0.12, y: ty0 + 0.4, w: 0.95, h: 0.22, fontFace: F.head, fontSize: 7.5,
                    color: C.greyLight, charSpacing: 0.6, bold: true, align: 'right',
                });
            });
            let ty = ty0 + 0.66;
            const fmtMin = (min: number | null, est = false) => min == null ? '–' : `${est ? '≈ ' : ''}${Math.max(1, min)} min`;
            for (const row of d.travel.slice(0, 5)) {
                s.addText([
                    { text: row.name, options: { fontFace: F.body, fontSize: 10.5, color: C.ink } },
                    { text: `  ${fmtNum(row.km, 1)} km`, options: { fontFace: F.body, fontSize: 8.5, color: C.greyLight } },
                ], { x: tx, y: ty, w: tw - 2.7, h: 0.3, valign: 'middle' });
                s.addText(fmtMin(row.walkMin, row.walkEst), { x: colX[1] - 0.12, y: ty, w: 0.95, h: 0.3, fontFace: F.body, fontSize: 10.5, color: C.ink, align: 'right', valign: 'middle' });
                s.addText(fmtMin(row.transitMin), { x: colX[2] - 0.12, y: ty, w: 0.95, h: 0.3, fontFace: F.body, fontSize: 10.5, color: C.ink, align: 'right', valign: 'middle' });
                s.addText(fmtMin(row.carMin), { x: colX[3] - 0.12, y: ty, w: 0.95, h: 0.3, fontFace: F.body, fontSize: 10.5, color: C.ink, align: 'right', valign: 'middle' });
                ty += 0.3;
                hairline(s, tx, ty - 0.015, tw, { strength: 93 });
            }
            const hasTransit = d.travel.some(r => r.transitMin != null);
            const anyEst = d.travel.some(r => r.walkEst && r.walkMin != null);
            caption(s, `Auto: OSRM.${hasTransit ? ' Joukkoliikenne ja kävely: Digitransit (HSL).' : ' Joukkoliikenneajat vaativat Digitransit-avaimen.'}${anyEst ? ' ≈ arvio linnuntietä.' : ''}`, tx, ty + 0.06, tw, 0.4);
        };

        if (maps.asemakaava) {
            label(s, 'Asemakaavaote (ajantasa-asemakaava)', LX, Y0, LW);
            s.addImage({ data: b64(maps.asemakaava), x: LX, y: Y0 + 0.3, w: LW, h: 4.71 });
            caption(s, 'Tontin rajaus oranssilla.', LX, Y0 + 5.07, LW);

            label(s, 'Palvelut', RX, Y0, RW);
            s.addImage({ data: b64(maps.services), x: RX, y: Y0 + 0.3, w: RW, h: 2.6 });
            legend(RX, Y0 + 2.96, RW);
            travelBlock(RX, RW, Y0 + 3.36);
        } else {
            label(s, 'Palvelut', LX, Y0, LW);
            s.addImage({ data: b64(maps.servicesBig ?? maps.services), x: LX, y: Y0 + 0.3, w: LW, h: 4.71 });
            legend(LX, Y0 + 5.07, LW);

            travelBlock(RX, RW, Y0);
            if (d.plansNearby != null && d.plansNearby > 0) {
                s.addText(`Asemakaavaote on saatavilla toistaiseksi vain Helsingin tonteille. Säteellä on vireillä ${d.plansNearby} asemakaavaa.`, {
                    x: RX, y: Y0 + 3.4, w: RW, h: 0.6, fontFace: F.body, fontSize: 10, color: C.grey,
                    lineSpacingMultiple: 1.25, valign: 'top',
                });
            }
        }

        footer(s, wordmarkInk, 3, TOTAL);
    }

    // ── Slide 3 · Markkinadata ──────────────────────────────
    {
        const s = pres.addSlide();
        s.background = { color: C.paper };
        header(s, 'Markkinadata', 'Uudistuotanto ja vanha kanta',
            `STH ${d.snapshotLabel} · ${d.compsSaleN} Oikotie-ilmoitusta · Tilastokeskus · säde ${String(d.radiusKm).replace('.', ',')} km`);

        // KPI cards: swap in asking-price stats when the new-build radius is empty,
        // so the band always shows numbers rather than dashes.
        type Kpi = { l: string; v: string | null; sub: string };
        const cs = mk.compStats;
        const k1: Kpi = mk.omaEquivClearing
            ? {
                l: 'Uudis, kauppaava',
                v: `${mk.omaEquivClearing.est ? '≈ ' : ''}${fmtNum(Math.round(mk.omaEquivClearing.value))} €/m²`,
                sub: mk.omaEquivClearing.est ? 'vuokratonttikohteista, tonttiarviolla' : 'myyvät kohteet omalla tontilla',
            }
            : cs?.uudet.med
                ? { l: 'Uudet pyynnit', v: `${fmtNum(Math.round(cs.uudet.med))} €/m²`, sub: `Oikotie-mediaani, ${cs.uudet.n} kohdetta` }
                : { l: 'Uudis, kauppaava', v: null, sub: 'ei myyviä uudiskohteita säteellä' };
        const k2: Kpi = mk.resalePooled?.ktEurM2
            ? {
                l: 'Vanha, toteutunut',
                v: `${fmtNum(Math.round(mk.resalePooled.ktEurM2))} €/m²`,
                sub: `${mk.resalePooled.sales12mo} kauppaa 12 kk${mk.resalePooled.trendPct != null ? ` · ${mk.resalePooled.trendPct >= 0 ? '+' : ''}${mk.resalePooled.trendPct.toFixed(1).replace('.', ',')} % / 12 kk` : ''}`,
            }
            : { l: 'Vanha, toteutunut', v: null, sub: 'ei StatFin-dataa alueelta' };
        const k3: Kpi = mk.premium != null
            ? { l: 'Uudispreemio', v: `${mk.premium >= 0 ? '+' : ''}${Math.round(mk.premium * 100)} %`, sub: `vs. ${mk.premiumVsRealized ? 'toteutuneet kaupat' : 'vanhat pyynnit'}` }
            : cs?.vanhat.med
                ? { l: 'Vanhat pyynnit', v: `${fmtNum(Math.round(cs.vanhat.med))} €/m²`, sub: `Oikotie-mediaani, ${cs.vanhat.n} kohdetta` }
                : { l: 'Uudispreemio', v: null, sub: 'preemiota ei voi laskea' };
        const k4: Kpi = st.projects > 0
            ? { l: 'Tuleva tarjonta', v: `${fmtNum(st.pipelineUnits)} as.`, sub: 'myymättä keskeneräisissä säteellä' }
            : { l: 'Tuleva tarjonta', v: '0 as.', sub: 'ei keskeneräisiä uudiskohteita säteellä' };

        const kpis = [k1, k2, k3, k4];
        const GAP = 0.24, cardW = (CONTENT_W - 3 * GAP) / 4, cardH = 1.5;
        kpis.forEach((k, i) => {
            const x = M + i * (cardW + GAP);
            card(s, x, Y0, cardW, cardH);
            label(s, k.l, x + 0.2, Y0 + 0.16, cardW - 0.4);
            if (k.v != null) {
                s.addText(k.v, {
                    x: x + 0.17, y: Y0 + 0.42, w: cardW - 0.3, h: 0.5, fontFace: F.head, fontSize: 25,
                    color: C.ink, bold: true,
                });
            } else {
                s.addText('ei dataa', {
                    x: x + 0.2, y: Y0 + 0.5, w: cardW - 0.4, h: 0.36, fontFace: F.body, fontSize: 13,
                    color: C.greyLight, italic: true,
                });
            }
            s.addText(k.sub, {
                x: x + 0.2, y: Y0 + 0.98, w: cardW - 0.4, h: 0.44, fontFace: F.body, fontSize: 8.5,
                color: C.grey, lineSpacingMultiple: 1.15, valign: 'top',
            });
        });

        // charts band
        const CY = 3.36, colW = 3.86;
        const xA = M, xB = 4.73, xC = 8.84;
        const imgY = CY + 0.32, imgH = 2.56, capY = imgY + imgH + 0.08;

        if (mixImg) {
            label(s, 'Huoneistojakauma säteellä', xA, CY, colW);
            s.addImage({ data: b64(mixImg), x: xA, y: imgY, w: colW, h: imgH });
            s.addText([
                { text: '● ', options: { fontFace: F.body, fontSize: 9.5, color: C.orange } },
                { text: 'myyty 12 kk    ', options: { fontFace: F.body, fontSize: 9, color: C.grey } },
                { text: '● ', options: { fontFace: F.body, fontSize: 9.5, color: C.greyLight } },
                { text: 'myynnissä nyt', options: { fontFace: F.body, fontSize: 9, color: C.grey } },
            ], { x: xA, y: capY, w: colW, h: 0.26 });
        }

        if (quarterImg && !wideQuarters) {
            label(s, 'Kaupat / neljännes, vanha kanta', xB, CY, colW);
            s.addImage({ data: b64(quarterImg), x: xB, y: imgY, w: colW, h: imgH });
            caption(s, 'Postinumeroalueet yhteensä · tuorein neljännes ennakollinen (ääriviiva)', xB, capY, colW, 0.4);
        } else if (quarterImg && wideQuarters) {
            const wq = xC - 0.25 - xA;
            label(s, 'Toteutuneet kaupat / neljännes, vanha kanta', xA, CY, wq);
            s.addImage({ data: b64(quarterImg), x: xA, y: imgY, w: wq, h: wq * (275 / 760) });
            caption(s, 'Postinumeroalueet yhteensä · tuorein neljännes ennakollinen (ääriviiva). Säteellä ei ole STH-seurattuja uudiskohteita, joten huoneistojakaumaa uudistuotannosta ei voi laskea.', xA, imgY + wq * (275 / 760) + 0.08, wq, 0.5);
        } else if (!mixImg) {
            label(s, 'Huoneistojakauma säteellä', xA, CY, colW);
            s.addText('Ei uudiskohteita säteellä, jakaumaa ei voi laskea.', {
                x: xA, y: imgY, w: colW, h: 0.5, fontFace: F.body, fontSize: 10.5, color: C.greyLight, italic: true,
            });
        }

        // right chart column: product types + pipeline, or asking-price medians
        if (a.products.length) {
            label(s, 'Tuotetyypit säteellä', xC, CY, RE - xC);
            let py = imgY + 0.04;
            for (const pr of a.products.slice(0, 3)) {
                s.addText(pr.label, { x: xC, y: py, w: RE - xC, h: 0.26, fontFace: F.head, fontSize: 11, color: C.ink, bold: true });
                s.addText(`myyty ${pr.sold12} · myynnissä ${pr.forSale} · varasto ${formatMonthsInv(pr.monthsInventory)} kk`, {
                    x: xC, y: py + 0.25, w: RE - xC, h: 0.22, fontFace: F.body, fontSize: 8.5, color: C.grey,
                });
                py += 0.56;
            }
            if (a.pipeline.length) {
                py += 0.1;
                label(s, 'Valmistuu säteellä', xC, py, RE - xC);
                py += 0.32;
                for (const pe of a.pipeline.slice(0, 3)) {
                    const nm = pe.project.name.length > 26 ? pe.project.name.slice(0, 25) + '…' : pe.project.name;
                    s.addText(nm, { x: xC, y: py, w: RE - xC, h: 0.22, fontFace: F.body, fontSize: 10, color: C.ink });
                    s.addText(`${pe.project.forSale} as. myymättä · ${formatYm(pe.project.completionYm)}`, {
                        x: xC, y: py + 0.21, w: RE - xC, h: 0.2, fontFace: F.body, fontSize: 8.5, color: C.grey,
                    });
                    py += 0.5;
                }
            }
        } else if (cs && (cs.uudet.med || cs.uudehkot.med || cs.vanhat.med)) {
            const px = xC, pw = RE - xC;
            label(s, 'Pyyntihinnat säteellä (Oikotie)', px, CY, pw);
            let py = imgY + 0.05;
            const prow = (lbl: string, med: number | null, n: number) => {
                if (!med) return;
                s.addText(lbl, { x: px, y: py, w: pw - 1.3, h: 0.3, fontFace: F.body, fontSize: 10.5, color: C.ink, valign: 'middle' });
                s.addText(`${fmtNum(Math.round(med))} €/m²`, {
                    x: px + pw - 1.6, y: py, w: 1.6, h: 0.3, fontFace: F.head, fontSize: 12, color: C.ink, bold: true,
                    align: 'right', valign: 'middle',
                });
                caption(s, `${n} ilmoitusta`, px, py + 0.28, pw);
                py += 0.62;
                hairline(s, px, py - 0.1, pw, { strength: 92 });
            };
            prow('Uudet (2020-luku)', cs.uudet.med, cs.uudet.n);
            prow('Uudehkot (2010-luku)', cs.uudehkot.med, cs.uudehkot.n);
            prow('Vanhat', cs.vanhat.med, cs.vanhat.n);
            caption(s, 'Pyyntejä, eivät toteutuneita.', px, py + 0.02, pw);
        }

        footer(s, wordmarkInk, 4, TOTAL);
    }

    // ── Slide 4 · Johtopäätökset ────────────────────────────
    {
        const s = pres.addSlide();
        s.background = { color: C.paper };
        header(s, 'Johtopäätökset', 'Mitä tästä pitäisi ajatella', 'Tulkinta · perusteet edellisillä sivuilla');

        const answers: { q: string; a: string; color: string; basis?: string }[] = [
            {
                q: 'Myykö alue?',
                a: mk.areaVerdict?.label ?? 'Ei riittävää näyttöä',
                color: mk.areaVerdict ? verdictTone(mk.areaVerdict.label) : C.greyLight,
                basis: mk.areaVerdict ? `${mk.areaVerdict.basis}${mk.areaVerdict.source === 'vanha' ? ' · vanhan kannan data' : ''}` : undefined,
            },
            {
                q: 'Likvidi hinta',
                a: mk.liquidBand ? `${fmtNum(mk.liquidBand.lo)}–${fmtNum(mk.liquidBand.hi)} €/m²` : 'Ei riittävää näyttöä',
                color: mk.liquidBand ? C.ink : C.greyLight,
                basis: mk.liquidBand
                    ? mk.liquidBand.source === 'movers' ? `myyvien uudiskohteiden taso (${mk.liquidBand.n} kohdetta)`
                        : mk.liquidBand.source === 'movers-converted' ? `myyvät kohteet, vuokratontit muunnettu tonttiarviolla (${mk.liquidBand.n} kohdetta)`
                            : `arvio: toteutunut vanha × preemio ${mk.liquidBand.premiumUsed ? Math.round((mk.liquidBand.premiumUsed - 1) * 100) + ' %' : ''}`
                    : undefined,
            },
            {
                q: 'Mitä rakentaa',
                a: mk.topProduct && !mk.sthThin ? mk.topProduct.label
                    : mk.infillBuild ? mk.infillBuild.label : 'Ei riittävää näyttöä',
                color: (mk.topProduct && !mk.sthThin) || mk.infillBuild ? C.ink : C.greyLight,
                basis: mk.topProduct && !mk.sthThin
                    ? `nopein kierto ja suurin volyymi säteellä${mk.topGap ? ` · huoneistovaje: ${mk.topGap.type}` : ''}`
                    : mk.infillBuild ? `${mk.infillBuild.basis}, vanhan kannan signaali` : undefined,
            },
        ];
        const GAP = 0.24, awW = (CONTENT_W - 2 * GAP) / 3, awH = 1.66;
        answers.forEach((an, i) => {
            const x = M + i * (awW + GAP);
            card(s, x, Y0, awW, awH);
            label(s, an.q, x + 0.22, Y0 + 0.18, awW - 0.44);
            s.addText(an.a, {
                x: x + 0.19, y: Y0 + 0.44, w: awW - 0.36, h: 0.72, fontFace: F.head,
                fontSize: an.a.length > 24 ? 17 : 23, color: an.color, bold: true, valign: 'top',
            });
            if (an.basis) s.addText(sanitize(an.basis), {
                x: x + 0.22, y: Y0 + 1.16, w: awW - 0.44, h: 0.44, fontFace: F.body, fontSize: 8.5,
                color: C.grey, lineSpacingMultiple: 1.15, valign: 'top',
            });
        });

        const BY = Y0 + awH + 0.34; // 3.56
        // left: revenue math + price ladder
        let ly = BY;
        if (plot.buildingRight && mk.liquidBand) {
            const sellable = plot.buildingRight * 0.83;
            const lo = sellable * mk.liquidBand.lo, hi = sellable * mk.liquidBand.hi;
            label(s, 'Bruttomyynti likvidillä tasolla', LX, ly, LW);
            const runs: pptxgen.TextProps[] = [
                { text: 'Rakennusoikeus ', options: {} },
                { text: `${fmtNum(plot.buildingRight)} k-m²`, options: { bold: true } },
                { text: ' antaa likvidillä tasolla noin ', options: {} },
                { text: `${fmtMEur(lo)}–${fmtMEur(hi)}`, options: { bold: true } },
                { text: ' bruttomyynnin, kun myytävää alaa on 83 % kerrosalasta.', options: {} },
            ];
            if (plot.priceEst) {
                const share = plot.priceEst / ((lo + hi) / 2);
                runs.push({ text: ' Hinta-arvio ', options: {} });
                runs.push({ text: fmtMEur(plot.priceEst), options: { bold: true } });
                runs.push({ text: ` on ${fmtNum(share * 100, 0)} % bruttomyynnistä.`, options: {} });
            }
            if (mk.sellout != null && mk.topProduct) {
                runs.push({ text: ` Parhaiten kiertävällä tuotteella (${mk.unitCount} as.) myyntiaika on nykytahdilla noin `, options: {} });
                runs.push({ text: `${mk.sellout} kk`, options: { bold: true } });
                runs.push({ text: ' oman ja kilpailevan varaston kanssa.', options: {} });
            }
            s.addText(runs.map(r => ({ text: r.text, options: { ...r.options, fontFace: F.body, fontSize: 12, color: C.ink } })), {
                x: LX, y: ly + 0.32, w: LW, h: 1.1, lineSpacingMultiple: 1.3, valign: 'top',
            });
            ly += 1.56;
        }
        if (ladderImg) {
            label(s, 'Hintaportaat, €/m² omistusvertailu', LX, ly, LW);
            s.addImage({ data: b64(ladderImg), x: LX, y: ly + 0.3, w: LW, h: LW * (190 / 760) });
        }

        // right: observations
        label(s, 'Havainnot', RX, BY, RW);
        const toneColor = (t: string) => t === 'pos' ? C.pos : t === 'neg' ? C.neg : C.greyLight;
        let vy = BY + 0.32;
        for (const v of mk.verdict.slice(0, 6)) {
            const txt = sanitize(v.text);
            const slot = txt.length > 92 ? 0.66 : 0.46;
            if (vy + slot > 6.6) break;
            s.addText([
                { text: '●  ', options: { fontFace: F.head, fontSize: 9, color: toneColor(v.tone) } },
                { text: txt, options: { fontFace: F.body, fontSize: 10.5, color: C.ink } },
            ], { x: RX, y: vy, w: RW, h: slot, lineSpacingMultiple: 1.2, valign: 'top' });
            vy += slot;
        }
        // the sell-out estimate lives in the revenue paragraph; repeat it here
        // only when that paragraph was skipped and there is room
        if (mk.sellout != null && mk.topProduct && !(plot.buildingRight && mk.liquidBand) && vy + 0.85 <= 7.02) {
            s.addText(
                `Jos rakennat ${mk.unitCount} asuntoa parhaiten kiertävää tuotetta, myyntiaika nykytahdilla on noin ${mk.sellout} kk oman ja kilpailevan varaston kanssa.`,
                { x: RX, y: vy + 0.14, w: RW, h: 0.66, fontFace: F.body, fontSize: 10, color: C.grey, lineSpacingMultiple: 1.25, valign: 'top' },
            );
        }

        footer(s, wordmarkInk, 5, TOTAL);
    }

    // ── Slide 5 · Näyttö ja varaumat ────────────────────────
    {
        const s = pres.addSlide();
        s.background = { color: C.paper };
        header(s, 'Näyttö ja varaumat', 'Mihin luvut nojaavat', `STH ${d.snapshotLabel} · säde ${String(d.radiusKm).replace('.', ',')} km`);

        const caveats: string[] = [];
        caveats.push(`Uudisnäyttö on ${a.nearby.length} kohdetta ${String(d.radiusKm).replace('.', ',')} km säteellä${mk.sthThin ? ', otos on ohut ja mediaanit heiluvat' : ''}.`);
        caveats.push('Toteutuneet kaupat ovat postinumeroalueilta, eivät säteeltä, ja tuorein neljännes on ennakollinen.');
        if (mk.plotEstimate) caveats.push(`Vuokratonttikohteet on muunnettu omistusvertailuun tonttiarviolla ${fmtEur(mk.plotEstimate.value)} €/m² (${mk.plotEstimate.source}).`);
        caveats.push('Oikotie-hinnat ovat pyyntejä, eivät toteutuneita.');
        if (mk.liquidBand?.source === 'resale-premium') caveats.push('Likvidi hinta on johdettu vanhan kannan hinnasta ja preemiosta, ei myyvistä uudiskohteista.');

        const caveatBlock = (x: number, y: number, w: number, size: number) => {
            let cy = y;
            for (const cv of caveats) {
                const txt = sanitize(cv);
                const slot = txt.length > (w > 6 ? 105 : 78) ? 0.68 : 0.46;
                s.addText([
                    { text: '●  ', options: { fontFace: F.head, fontSize: 8, color: C.greyLight } },
                    { text: txt, options: { fontFace: F.body, fontSize: size, color: C.grey } },
                ], { x, y: cy, w, h: slot, lineSpacingMultiple: 1.2, valign: 'top' });
                cy += slot;
            }
            return cy;
        };

        const sources: { n: string; det: string }[] = [
            { n: 'STH-uudiskohdeseuranta', det: `snapshot ${d.snapshotLabel}, kohteet säteellä` },
            { n: 'Tilastokeskus (StatFin)', det: 'vanhan kannan kaupat postinumeroalueittain' },
            { n: 'Oikotie', det: `${d.compsSaleN} myynti-ilmoitusta lähialueen postinumeroilta` },
            { n: 'Maanmittauslaitos', det: 'kiinteistötunnus ja palstan rajaus' },
            ...(maps.asemakaava ? [{ n: 'Helsingin kaupunki', det: 'ajantasa-asemakaava (WMS)' }] : []),
            { n: 'OSRM · Digitransit (HSL)', det: 'matka-ajat autolla, joukkoliikenteellä ja kävellen' },
        ];

        if (a.nearby.length > 0) {
            // left: the evidence table
            label(s, `Uudiskohteet säteellä · ${a.nearby.length} kpl`, LX, Y0, LW);
            const tblRows: pptxgen.TableRow[] = [];
            const hd = (t: string, align: 'left' | 'right' = 'right') => ({
                text: t.toUpperCase(),
                options: { fontFace: F.head, fontSize: 7.5, color: C.greyLight, bold: true, align, charSpacing: 0.5 } as any,
            });
            const cell = (t: string, align: 'left' | 'right', shade: boolean) => ({
                text: t,
                options: { fontFace: F.body, fontSize: 9.5, color: C.ink, align, fill: shade ? { color: C.cream } : undefined } as any,
            });
            tblRows.push([hd('Kohde', 'left'), hd('km'), hd('as.'), hd('myyty 12 kk'), hd('myynnissä'), hd('var. kk'), hd('€/m²')]);
            a.nearby.slice(0, 9).forEach((n, i) => {
                const p = n.project;
                const nm = p.name.length > 26 ? p.name.slice(0, 25) + '…' : p.name;
                const shade = i % 2 === 0;
                tblRows.push([
                    cell(`${nm}${p.tenure !== 'oma' ? ' (vt)' : ''}`, 'left', shade),
                    cell(fmtNum(n.distanceKm, 1), 'right', shade),
                    cell(String(p.units), 'right', shade),
                    cell(String(p.sold12), 'right', shade),
                    cell(String(p.forSale), 'right', shade),
                    cell(formatMonthsInv(p.monthsInventory), 'right', shade),
                    cell(p.eurM2 > 0 ? fmtNum(Math.round(p.eurM2)) : '–', 'right', shade),
                ]);
            });
            s.addTable(tblRows, {
                x: LX, y: Y0 + 0.32, w: LW,
                colW: [2.5, 0.55, 0.5, 0.83, 0.8, 0.78, 0.72],
                border: { type: 'none' },
                rowH: 0.29,
                margin: 0.04,
                valign: 'middle',
            });
            const tblBottom = Y0 + 0.32 + 0.29 * Math.min(10, a.nearby.length + 1);
            if (a.nearby.some(n => n.project.tenure !== 'oma')) {
                caption(s, '(vt) = vuokratontti, €/m² ilman tontin osuutta.', LX, tblBottom + 0.08, LW);
            }
            if (a.builders.length) {
                const byN = a.builders.slice(0, 3).map(bd => `${bd.name} (${bd.projects} kohdetta, ${bd.sold12} myyty 12 kk)`).join(', ');
                const by2 = Math.max(tblBottom + 0.44, 5.0);
                label(s, 'Rakentajat säteellä', LX, by2, LW);
                s.addText(`${byN}.`, { x: LX, y: by2 + 0.3, w: LW, h: 0.56, fontFace: F.body, fontSize: 10, color: C.ink, lineSpacingMultiple: 1.25, valign: 'top' });
            }
            caption(s, `Lähteet: STH · Tilastokeskus · Oikotie · MML${maps.asemakaava ? ' · Hgin kaupunki' : ''} · OSRM · Digitransit (HSL)`, LX, 6.82, LW);

            // right: why movers move + caveats
            let ry = Y0;
            if (mk.cmpReasons.length) {
                label(s, 'Miksi myyvät myyvät', RX, ry, RW);
                ry += 0.32;
                for (const r of mk.cmpReasons.slice(0, 2)) {
                    s.addText(sanitize(r), { x: RX, y: ry, w: RW, h: 0.62, fontFace: F.body, fontSize: 10, color: C.ink, lineSpacingMultiple: 1.2, valign: 'top' });
                    ry += 0.66;
                }
                ry += 0.16;
            }
            label(s, 'Varaumat', RX, ry, RW);
            caveatBlock(RX, ry + 0.32, RW, 9.5);
        } else {
            // sparse branch: no project table to show — give caveats room and
            // make the evidence base explicit instead of leaving a void
            label(s, 'Näyttötilanne', LX, Y0, LW);
            s.addText(`Säteellä ei ole STH-seurattuja uudiskohteita, joten analyysi nojaa vanhan kannan toteutuneisiin kauppoihin ja Oikotie-pyynteihin.`, {
                x: LX, y: Y0 + 0.32, w: LW, h: 0.62, fontFace: F.body, fontSize: 11.5, color: C.ink,
                lineSpacingMultiple: 1.3, valign: 'top',
            });
            label(s, 'Varaumat', LX, Y0 + 1.18, LW);
            caveatBlock(LX, Y0 + 1.5, LW, 10.5);

            card(s, RX, Y0, RW, 0.62 + sources.length * 0.56);
            label(s, 'Lähteet', RX + 0.22, Y0 + 0.18, RW - 0.44);
            let sy = Y0 + 0.52;
            for (const src of sources) {
                s.addText(src.n, { x: RX + 0.22, y: sy, w: RW - 0.44, h: 0.24, fontFace: F.head, fontSize: 10, color: C.ink, bold: true });
                s.addText(src.det, { x: RX + 0.22, y: sy + 0.22, w: RW - 0.44, h: 0.24, fontFace: F.body, fontSize: 8.5, color: C.grey });
                sy += 0.56;
            }
        }

        footer(s, wordmarkInk, 6, TOTAL);
    }

    const out = await pres.write({ outputType: 'nodebuffer' });
    return out as Buffer;
}
