/**
 * Plan documents (kaavakartta + määräykset, kaavaselostus, CAD) for a Helsinki
 * asemakaava, as listed on the city's "Kaavadokumentit" page that the
 * karttapalvelu links to from a property's plan panel:
 *
 *   https://ptp.hel.fi/DataForms/planreport/Default.aspx?id=<kaavatunnus>
 *
 * The page is ASP.NET WebForms: every download is a __doPostBack link, so the
 * PDFs have no addressable URL. The postback does not need a session cookie,
 * so instead of proxying 20–200 MB files through this app we hand the browser
 * the form fields (viewstate etc.) and it submits the form to ptp.hel.fi in a
 * new tab itself — the PDF then streams directly from the city's server.
 */

export type PlanDocKind = 'kartta' | 'kartta-vari' | 'selostus' | 'cad' | 'muu';

export interface PlanDocument {
    kind: PlanDocKind;
    /** header on the page, e.g. "Kaavadokumentti (värillinen versio)" */
    label: string;
    filename: string;
    /** e.g. "19,74 MB" as printed on the page */
    size?: string;
    /** __EVENTTARGET for the postback */
    target: string;
}

export interface PlanDocuments {
    tunnus: string;
    /** human page for the plan's documents */
    pageUrl: string;
    /** form action to POST to (absolute) */
    action: string;
    /** hidden WebForms fields to include in the POST */
    fields: Record<string, string>;
    documents: PlanDocument[];
    fetchedAt: string;
}

export function planReportUrl(tunnus: string): string {
    return `https://ptp.hel.fi/DataForms/planreport/Default.aspx?id=${encodeURIComponent(tunnus)}`;
}

export function planPhasesUrl(tunnus: string): string {
    return `https://ptp.hel.fi/DataForms/Kaavavaihe?q=${encodeURIComponent(tunnus)}`;
}

/** Helsinki kaavatunnus: a number, occasionally with a letter suffix. */
export function isValidKaavatunnus(t: string | null | undefined): t is string {
    return !!t && /^[0-9]{1,6}[A-Za-z]?$/.test(t.trim());
}

function unescapeHtml(s: string): string {
    return s
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function classify(label: string): PlanDocKind {
    const l = label.toLowerCase();
    if (/selostus/.test(l)) return 'selostus';
    if (/cad|dgn|dwg/.test(l)) return 'cad';
    if (/värillinen|varillinen/.test(l)) return 'kartta-vari';
    if (/kaavadokumentti|kaavakartta|määräy/.test(l)) return 'kartta';
    return 'muu';
}

/** Pure parser — exported so it can be tested without network. */
export function parsePlanReport(html: string, tunnus: string): Omit<PlanDocuments, 'fetchedAt'> {
    const fields: Record<string, string> = {};
    const hiddenRe = /<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]*value="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = hiddenRe.exec(html)) !== null) {
        fields[m[1]] = unescapeHtml(m[2]);
    }
    const actionMatch = html.match(/<form[^>]+action="([^"]+)"/);
    const action = new URL(unescapeHtml(actionMatch?.[1] || `./Default.aspx?id=${tunnus}`), planReportUrl(tunnus)).toString();

    // Each document sits under a <span id="LabelN"><b>Header</b></span>; split on those.
    const documents: PlanDocument[] = [];
    const chunks = html.split(/(?=<span id="Label\d+")/);
    const headerRe = /<span id="Label\d+"[^>]*>\s*(?:<b>)?([\s\S]*?)(?:<\/b>)?\s*<\/span>/;
    const linkRe = /<a[^>]+href="javascript:__doPostBack\(&#39;([^&]+)&#39;,&#39;&#39;\)"[^>]*>([\s\S]*?)<\/a>\s*(?:\(([^)]+)\))?/g;
    for (const chunk of chunks) {
        const header = chunk.match(headerRe);
        const label = header ? unescapeHtml(header[1].replace(/<[^>]+>/g, '')).trim() : '';
        let a: RegExpExecArray | null;
        linkRe.lastIndex = 0;
        while ((a = linkRe.exec(chunk)) !== null) {
            const filename = unescapeHtml(a[2].replace(/<[^>]+>/g, '')).trim();
            if (!filename) continue;
            documents.push({
                kind: classify(label || filename),
                label: label || filename,
                filename,
                size: a[3]?.trim() || undefined,
                target: unescapeHtml(a[1]),
            });
        }
    }
    return { tunnus, pageUrl: planReportUrl(tunnus), action, fields, documents };
}

export async function fetchPlanDocuments(tunnus: string, signal?: AbortSignal): Promise<PlanDocuments> {
    if (!isValidKaavatunnus(tunnus)) throw new Error('invalid kaavatunnus');
    const res = await fetch(planReportUrl(tunnus), {
        headers: { 'User-Agent': 'Mozilla/5.0 (tonttihaku)', 'Accept': 'text/html' },
        signal,
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`ptp.hel.fi planreport: HTTP ${res.status}`);
    const html = await res.text();
    const parsed = parsePlanReport(html, tunnus.trim());
    if (!parsed.fields.__VIEWSTATE) throw new Error('ptp.hel.fi planreport: unexpected page');
    return { ...parsed, fetchedAt: new Date().toISOString() };
}
