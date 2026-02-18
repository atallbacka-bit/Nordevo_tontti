import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('plots')
            .select('kunta')
            .not('kunta', 'is', null)
            .neq('kunta', '');

        if (error) throw error;

        // Get unique kunnat
        const kunnat = Array.from(new Set((data || []).map((r: any) => r.kunta))).sort();
        return NextResponse.json(kunnat);
    } catch (error: any) {
        console.error('Kunnat API Error:', error);
        return NextResponse.json([], { status: 500 });
    }
}
