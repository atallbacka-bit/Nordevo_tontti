import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// STH market data rows. Each row: { data: <raw excel row keyed by column letter>,
// lat, lng, address_key }. Column B inside `data` is the snapshot date
// (e.g. 20260422) — the table intentionally holds MULTIPLE snapshots so the
// frontend can diff them; never wipe old snapshots on import.

export async function GET() {
    const supabase = getSupabaseAdmin();
    try {
        const { data, error } = await supabase
            .from('sales_analysis_data')
            .select('*')
            .limit(5000);

        if (error) throw error;

        return NextResponse.json(data || []);
    } catch (error) {
        console.error('Error fetching sales data:', error);
        return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const supabase = getSupabaseAdmin();
    try {
        const body = await req.json();
        const { action, data, snapshot } = body;

        if (action === 'deleteAll') {
            const { error } = await supabase
                .from('sales_analysis_data')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000');
            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        if (!Array.isArray(data)) {
            return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
        }

        // Re-importing the same snapshot replaces it; other snapshots are kept.
        if (action === 'replaceSnapshot' && snapshot) {
            const { error: delError } = await supabase
                .from('sales_analysis_data')
                .delete()
                .eq('data->>B', String(snapshot));
            if (delError) throw delError;
        }

        const { error } = await supabase
            .from('sales_analysis_data')
            .insert(data);
        if (error) throw error;

        return NextResponse.json({ success: true, inserted: data.length });

    } catch (error) {
        console.error('Error saving sales data:', error);
        return NextResponse.json({ error: 'Failed to save data' }, { status: 500 });
    }
}
