// Nordevo slide tokens for the auto-generated plot deck (see brand style guide).
// One accent per world: orange on paper, mint on dark. pptx colors are hex
// WITHOUT the leading '#'.

export const C = {
    paper: 'FAF5EC',
    ink: '221C12',
    dark: '0B0906',
    cream: 'F2ECDD',
    orange: 'C25A17',
    mint: 'A6CBBA',
    grey: '5A5142',
    greyLight: '8A7F6A',
    spruce: '1F4736',
    pos: '2E7D4F',   // semantic verdict tones — readability beats palette purity
    neg: 'B3403A',
} as const;

// CSS-hex variants for SVG chart rendering
export const H = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, `#${v}`])) as Record<keyof typeof C, string>;

// System fonts only: the deck must open correctly on any machine without
// installing typefaces (Familjen Grotesk/Newsreader substitution looked broken).
export const F = {
    head: 'Helvetica Neue',
    body: 'Georgia',
} as const;

// 16:9 deck geometry (inches)
export const PAGE = { w: 13.333, h: 7.5, margin: 0.62 } as const;

const NBSP = ' ';

/** fi-style number: non-breaking thin space thousands, comma decimals. */
export function fmtNum(v: number | null | undefined, digits = 0): string {
    if (v == null || !isFinite(v)) return '–';
    return v.toLocaleString('fi-FI', { minimumFractionDigits: digits, maximumFractionDigits: digits })
        .replace(/ /g, NBSP);
}

export function fmtEurM2(v: number | null | undefined): string {
    return v == null ? '–' : `${fmtNum(Math.round(v))}${NBSP}€/m²`;
}

export function fmtMEur(v: number | null | undefined): string {
    if (v == null || !isFinite(v)) return '–';
    return `${fmtNum(v / 1e6, 1)}${NBSP}M€`;
}

/** The brand bans em dashes in copy; site-generated sentences use them freely. */
export function sanitize(text: string): string {
    return text
        .replace(/\s+—\s+/g, ', ')
        .replace(/—/g, ',')
        .replace(/ {2,}/g, ' ');
}
