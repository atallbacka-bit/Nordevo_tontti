// Brand-styled chart images for the deck, drawn as SVG and rasterized with
// sharp. Orange carries "realized demand", warm grey carries supply; the only
// other ink is hairlines and labels — no gridlines, boxes or legends inside
// the plot area (legends live in the slide caption).

import sharp from 'sharp';
import { H } from './style';

const FG = `'Helvetica Neue', Helvetica, Arial, sans-serif`;

async function toPng(svg: string): Promise<Buffer> {
    return sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface MixBar { type: string; sold: number; unsold: number }

/** Huoneistojakauma: sold (12 mo, orange = demand) vs currently unsold units. */
export async function mixChart(bars: MixBar[], width = 560, height = 330): Promise<Buffer> {
    const W = width * 2, HH = height * 2;
    const padL = 16, padR = 16, padB = 62, padT = 52;
    const plotW = W - padL - padR, plotH = HH - padT - padB;
    const maxV = Math.max(1, ...bars.flatMap(b => [b.sold, b.unsold]));
    const groupW = plotW / bars.length;
    const barW = Math.min(66, groupW * 0.3);
    let s = '';
    bars.forEach((b, i) => {
        const cx = padL + groupW * (i + 0.5);
        const hS = (b.sold / maxV) * plotH;
        const hU = (b.unsold / maxV) * plotH;
        const y0 = padT + plotH;
        s += `<rect x="${cx - barW - 5}" y="${y0 - hS}" width="${barW}" height="${Math.max(hS, 3)}" fill="${H.orange}"/>`;
        s += `<rect x="${cx + 5}" y="${y0 - hU}" width="${barW}" height="${Math.max(hU, 3)}" fill="${H.greyLight}" opacity="0.55"/>`;
        if (b.sold > 0) s += `<text x="${cx - 5 - barW / 2}" y="${y0 - hS - 12}" text-anchor="middle" font-family=${JSON.stringify(FG)} font-weight="600" font-size="27" fill="${H.orange}">${b.sold}</text>`;
        if (b.unsold > 0) s += `<text x="${cx + 5 + barW / 2}" y="${y0 - hU - 12}" text-anchor="middle" font-family=${JSON.stringify(FG)} font-weight="600" font-size="27" fill="${H.greyLight}">${b.unsold}</text>`;
        s += `<text x="${cx}" y="${y0 + 44}" text-anchor="middle" font-family=${JSON.stringify(FG)} font-weight="600" font-size="27" letter-spacing="0.5" fill="${H.grey}">${esc(b.type)}</text>`;
    });
    const base = `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${H.ink}" stroke-opacity="0.3" stroke-width="2.5"/>`;
    return toPng(`<svg width="${W}" height="${HH}" viewBox="0 0 ${W} ${HH}" xmlns="http://www.w3.org/2000/svg">${base}${s}</svg>`);
}

export interface QuarterBar { q: string; count: number; prelim: boolean }

/** Realized old-stock sales per quarter (StatFin); preliminary quarter outlined. */
export async function quarterChart(bars: QuarterBar[], width = 560, height = 330): Promise<Buffer> {
    const W = width * 2, HH = height * 2;
    const padL = 16, padR = 16, padB = 62, padT = 52;
    const plotW = W - padL - padR, plotH = HH - padT - padB;
    const maxV = Math.max(1, ...bars.map(b => b.count));
    const groupW = plotW / bars.length;
    const barW = Math.min(84, groupW * 0.56);
    let s = '';
    bars.forEach((b, i) => {
        const cx = padL + groupW * (i + 0.5);
        const h = (b.count / maxV) * plotH;
        const y0 = padT + plotH;
        s += b.prelim
            ? `<rect x="${cx - barW / 2}" y="${y0 - h}" width="${barW}" height="${Math.max(h, 3)}" fill="none" stroke="${H.grey}" stroke-width="3.5"/>`
            : `<rect x="${cx - barW / 2}" y="${y0 - h}" width="${barW}" height="${Math.max(h, 3)}" fill="${H.grey}"/>`;
        s += `<text x="${cx}" y="${y0 - h - 12}" text-anchor="middle" font-family=${JSON.stringify(FG)} font-weight="600" font-size="27" fill="${H.ink}">${b.count}</text>`;
        const label = b.q.replace(/^20/, '').replace('Q', '/Q');
        s += `<text x="${cx}" y="${y0 + 44}" text-anchor="middle" font-family=${JSON.stringify(FG)} font-weight="600" font-size="24" fill="${H.grey}">${esc(label)}</text>`;
    });
    const base = `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${H.ink}" stroke-opacity="0.3" stroke-width="2.5"/>`;
    return toPng(`<svg width="${W}" height="${HH}" viewBox="0 0 ${W} ${HH}" xmlns="http://www.w3.org/2000/svg">${base}${s}</svg>`);
}

export interface LadderPoint { label: string; value: number; emph?: 'accent' | 'muted' }

/** Price ladder on one horizontal €/m² axis. */
export async function ladderChart(points: LadderPoint[], width = 760, height = 210): Promise<Buffer> {
    const W = width * 2, HH = height * 2;
    const padL = 180, padR = 180;
    const axisY = HH * 0.56;
    const vals = points.map(p => p.value);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(hi - lo, 1);
    const x = (v: number) => padL + ((v - lo) / span) * (W - padL - padR);

    // stagger labels above/below to avoid collisions
    const sorted = [...points].sort((a, b) => a.value - b.value);
    let s = `<line x1="${padL - 24}" y1="${axisY}" x2="${W - padR + 24}" y2="${axisY}" stroke="${H.ink}" stroke-opacity="0.3" stroke-width="2.5"/>`;
    sorted.forEach((p, i) => {
        const px = x(p.value);
        const up = i % 2 === 0;
        const color = p.emph === 'accent' ? H.orange : p.emph === 'muted' ? H.greyLight : H.ink;
        s += `<line x1="${px}" y1="${axisY - 15}" x2="${px}" y2="${axisY + 15}" stroke="${color}" stroke-width="3" stroke-opacity="0.5"/>`;
        s += `<circle cx="${px}" cy="${axisY}" r="13" fill="${color}" stroke="#FAF5EC" stroke-width="3"/>`;
        const ty = up ? axisY - 88 : axisY + 66;
        const vy = up ? axisY - 44 : axisY + 114;
        s += `<text x="${px}" y="${ty}" text-anchor="middle" font-family=${JSON.stringify(FG)} font-weight="600" font-size="30" fill="${color}">${esc(p.label)}</text>`;
        s += `<text x="${px}" y="${vy}" text-anchor="middle" font-family=${JSON.stringify(FG)} font-weight="700" font-size="40" fill="${H.ink}">${Math.round(p.value).toLocaleString('fi-FI').replace(/ /g, ' ')}</text>`;
    });
    return toPng(`<svg width="${W}" height="${HH}" viewBox="0 0 ${W} ${HH}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`);
}
