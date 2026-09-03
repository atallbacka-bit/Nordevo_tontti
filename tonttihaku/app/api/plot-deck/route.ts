import { NextRequest, NextResponse } from 'next/server';
import { collectDeckData } from '@/lib/deck/data';
import { buildDeck } from '@/lib/deck/build';

// Auto-generated PowerPoint for one plot:
// GET /api/plot-deck?id=<plotId>[&radius=1]
// Cover + 3 raw-data slides (plot, location/services, market data) + 2
// interpretation slides (verdict, evidence & caveats). Market numbers come
// through the same internal API routes the analysis panel uses, so the deck
// always says the same thing as the map.

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const radius = Math.min(5, Math.max(0.5, parseFloat(req.nextUrl.searchParams.get('radius') || '1') || 1));

    const cookie = req.headers.get('cookie') || '';
    const origin = req.nextUrl.origin;
    const fetchInternal = async (path: string): Promise<any | null> => {
        try {
            const res = await fetch(new URL(path, origin), { headers: { cookie }, cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    };

    try {
        const data = await collectDeckData(id, fetchInternal, radius);
        const pptx = await buildDeck(data);
        const safeName = (data.plot.name || 'tontti').replace(/[^\wäöåÄÖÅ\- ]/g, '').trim().replace(/\s+/g, '_');
        return new NextResponse(new Uint8Array(pptx), {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'Content-Disposition': `attachment; filename="Nordevo_Tonttianalyysi_${encodeURIComponent(safeName)}.pptx"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (err: any) {
        console.error('plot-deck failed:', err);
        return NextResponse.json({ error: err?.message || 'Deck generation failed' }, { status: 500 });
    }
}
