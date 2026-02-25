import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET() {
    const supabase = getSupabaseAdmin();
    try {
        const { data, error } = await supabase
            .from('sales_analysis_data')
            .select('*');

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
        const { action, data } = body;

        if (action === 'deleteAll') {
            const { error } = await supabase
                .from('sales_analysis_data')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows

            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        // Default action: Add/Update Data
        // Expects `data` to be an array of { data: object, lat: number, lng: number, address_key: string }
        if (!Array.isArray(data)) {
            return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
        }

        // Since we want to update the dataset, we can handle duplicates in a few ways:
        // 1. Delete all existing and replace (simple, but loses history if we care)
        // 2. Upsert based on address_key (keeps existing, updates content)

        // For this use case, "Update Database" implies we want the new file's content to potentially override or add to existing.
        // Let's go with Upsert on address_key if we had a unique constraint, but we didn't add one yet.
        // Simpler approach: 
        // If the user wants to "Update Database", we can just Insert. 
        // But to avoid duplicates, we should check first.

        // Let's implement a "smart merge":
        // 1. Fetch existing keys.
        // 2. Filter out already existing keys from the input.
        // 3. Insert only new items.
        // 4. (Optional) Update existing items if data changed.

        // To keep it simple and performant for ~300 items:
        // We will just insert the new batch. The frontend is responsible for deduplicating against *loaded* data before sending.
        // But if we want to be safe, we can use `upsert` if we add a unique constraint.
        // Without unique constraint, let's just insert.

        const { error } = await supabase
            .from('sales_analysis_data')
            .insert(data);

        if (error) throw error;

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Error saving sales data:', error);
        return NextResponse.json({ error: 'Failed to save data' }, { status: 500 });
    }
}
