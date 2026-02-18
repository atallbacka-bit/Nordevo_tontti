import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
    try {
        const { plotIds } = await request.json();
        const supabase = getSupabaseAdmin();

        let plots;
        if (plotIds && Array.isArray(plotIds) && plotIds.length > 0) {
            const { data, error } = await supabase
                .from('plots')
                .select('*')
                .in('id', plotIds);
            if (error) throw error;
            plots = data || [];
        } else {
            const { data, error } = await supabase
                .from('plots')
                .select('*')
                .neq('status', 'Mennyt');
            if (error) throw error;
            plots = data || [];
        }

        // Prepare data for export
        const exportData = plots.map((plot: any) => {
            const safeParse = (jsonStr: string, fallback: any) => {
                if (!jsonStr) return fallback;
                try {
                    const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
                    return Array.isArray(parsed) ? parsed : fallback;
                } catch { return fallback; }
            };

            const zonings = safeParse(plot.zonings, []);
            const zoningStr = zonings.map((z: any) => `${z.type} (${z.buildingRight} k-m²)`).join(', ');

            const contactPersons = safeParse(plot.contactPersons, []);
            const contactPersonsStr = contactPersons.map((cp: any) =>
                `${cp.name}${cp.role ? ` (${cp.role})` : ''}${cp.phone ? ` ${cp.phone}` : ''}${cp.email ? ` ${cp.email}` : ''}`
            ).join('; ');

            const notes = safeParse(plot.notes, []);
            const contacts = safeParse(plot.contacts, []);

            const allInteractions = [
                ...notes.map((n: any) => ({ date: new Date(n.timestamp), text: n.text, type: 'Muistiinpano', author: n.author })),
                ...contacts.map((c: any) => ({ date: new Date(c.date || c.timestamp), text: c.desc || c.text || '', type: c.method || 'Kontaktointi', author: c.agent || c.author || '' }))
            ].sort((a, b) => b.date.getTime() - a.date.getTime());

            const allNotesStr = allInteractions
                .map((i: any, idx: number) => `${idx + 1}. ${i.date.toLocaleDateString('fi-FI')} [${i.type}] ${i.text} (${i.author})`)
                .join('\n');

            const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('fi-FI') : '';

            const buildingRight = plot.buildingRight || 0;
            const priceEst = plot.priceEst || 0;
            const unitPrice = (buildingRight > 0 && priceEst > 0) ? Math.round(priceEst / buildingRight) : 0;

            return {
                'Tontin Nimi': plot.name || '',
                'Osoite': plot.address || '',
                'Kunta': plot.kunta || 'Helsinki',
                'Kiinteistötunnus': plot.kiinteistotunnus || '',
                'Tila': plot.status || '',
                'Kaavatyypit': zoningStr,
                'Kok. Rakennusoikeus (k-m²)': buildingRight,
                'Pinta-ala (m²)': plot.area || 0,
                'Hinta-arvio (€)': priceEst,
                'k-m² Hinta (€)': unitPrice,
                'Myyjä': plot.seller || '',
                'Kuvaus': plot.desc || '',
                'Yhteyshenkilöt': contactPersonsStr,
                'Muistiinpanot & Kontaktoinnit': allNotesStr,
                'Deadline (vain jos kilpailussa)': formatDate(plot.deadline),
                'Lisätty': formatDate(plot.createdAt),
                'Lisääjä': plot.createdBy || '',
                'Päivitetty': formatDate(plot.updatedAt),
                'ID': plot.id || ''
            };
        });

        if (exportData.length === 0) {
            return NextResponse.json({ error: 'Ei tontteja vietäväksi.' }, { status: 400 });
        }

        const ws = XLSX.utils.json_to_sheet(exportData);

        // Set column widths
        const headers = Object.keys(exportData[0] || {});
        const wideColumns = ['Muistiinpanot & Kontaktoinnit', 'Kuvaus', 'Yhteyshenkilöt', 'Kaavatyypit'];
        ws['!cols'] = headers.map(key => ({
            wch: wideColumns.includes(key) ? 60 : Math.max(key.length + 2, 18)
        }));

        // Set row heights
        const rowHeights: { hpt: number }[] = [{ hpt: 20 }];
        exportData.forEach((row: any) => {
            const maxLines = Math.max(
                ...Object.values(row).map((val: any) => {
                    const str = String(val || '');
                    return str.split('\n').length;
                })
            );
            rowHeights.push({ hpt: Math.max(15, maxLines * 15) });
        });
        ws['!rows'] = rowHeights;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Tontit');

        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
        const filename = `tontit_export_${new Date().toISOString().split('T')[0]}.xlsx`;

        return new NextResponse(buf, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (err: any) {
        console.error('Export error:', err);
        return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
    }
}
