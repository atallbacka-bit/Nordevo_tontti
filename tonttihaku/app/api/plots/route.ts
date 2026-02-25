import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Normalize kunta: capitalize first letter, lowercase rest
function normalizeKunta(kunta: string): string {
    if (!kunta) return 'Helsinki';
    const trimmed = kunta.trim();
    if (!trimmed) return 'Helsinki';
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        const { data: plots, error } = await supabase
            .from('plots')
            .select('*');

        if (error) throw error;
        return NextResponse.json(plots || []);
    } catch (error: any) {
        console.error("PLOTS API Error:", error);
        return NextResponse.json({ error: "Failed to read data" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { action, plot, id, note } = body;
        const supabase = getSupabaseAdmin();

        if (action === 'add') {
            const newId = Date.now().toString();
            const { error } = await supabase.from('plots').insert({
                id: newId,
                name: plot.name || 'Nimetön',
                zonings: typeof plot.zonings === 'string' ? plot.zonings : JSON.stringify(plot.zonings || []),
                buildingRight: Number(plot.buildingRight) || 0,
                area: Number(plot.area) || 0,
                priceEst: Number(plot.priceEst) || 0,
                desc: plot.desc || '',
                seller: plot.seller || '',
                status: plot.status || 'Vapaa',
                deadline: plot.deadline || '',
                address: plot.address || '',
                kunta: normalizeKunta(plot.kunta),
                kiinteistotunnus: plot.kiinteistotunnus || '',
                lat: Number(plot.lat) || 0,
                lng: Number(plot.lng) || 0,
                createdAt: new Date().toISOString(),
                createdBy: plot.createdBy || 'Tuntematon',
                updatedAt: '',
                updatedBy: '',
                notes: typeof plot.notes === 'string' ? plot.notes : JSON.stringify(plot.notes || []),
                buyer: plot.buyer || '',
                finalPrice: Number(plot.finalPrice) || 0,
                soldDate: plot.soldDate || '',
                pricePerRight: Number(plot.pricePerRight) || 0,
                offerPrice: Number(plot.offerPrice) || 0,
                offerDate: plot.offerDate || '',
                offerDesc: plot.offerDesc || '',
                contactPerson: plot.contactPerson || '',
                contactPhone: plot.contactPhone || '',
                contactEmail: plot.contactEmail || '',
                contacts: typeof plot.contacts === 'string' ? plot.contacts : JSON.stringify(plot.contacts || []),
                contactPersons: typeof plot.contactPersons === 'string' ? plot.contactPersons : JSON.stringify(plot.contactPersons || []),
                priority: Number(plot.priority) || 0
            });

            if (error) throw error;

            const { data: plots } = await supabase.from('plots').select('*');
            return NextResponse.json({ success: true, plots: plots || [] });

        } else if (action === 'update') {
            // First get existing
            const { data: existing, error: fetchError } = await supabase
                .from('plots')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchError || !existing) {
                return NextResponse.json({ error: "Plot not found" }, { status: 404 });
            }

            const updated = { ...existing, ...plot };

            const { error } = await supabase
                .from('plots')
                .update({
                    name: updated.name,
                    zonings: typeof updated.zonings === 'string' ? updated.zonings : JSON.stringify(updated.zonings || []),
                    buildingRight: Number(updated.buildingRight) || 0,
                    area: Number(updated.area) || 0,
                    priceEst: Number(updated.priceEst) || 0,
                    desc: updated.desc,
                    seller: updated.seller,
                    status: updated.status,
                    deadline: updated.deadline,
                    address: updated.address,
                    kunta: normalizeKunta(updated.kunta),
                    kiinteistotunnus: updated.kiinteistotunnus || '',
                    lat: Number(updated.lat) || 0,
                    lng: Number(updated.lng) || 0,
                    updatedAt: new Date().toISOString(),
                    updatedBy: updated.updatedBy || existing.updatedBy,
                    notes: typeof updated.notes === 'string' ? updated.notes : JSON.stringify(updated.notes || []),
                    buyer: updated.buyer,
                    finalPrice: Number(updated.finalPrice) || 0,
                    soldDate: updated.soldDate,
                    pricePerRight: Number(updated.pricePerRight) || 0,
                    offerPrice: Number(updated.offerPrice) || 0,
                    offerDate: updated.offerDate,
                    offerDesc: updated.offerDesc,
                    contactPerson: updated.contactPerson,
                    contactPhone: updated.contactPhone,
                    contactEmail: updated.contactEmail,
                    contacts: typeof updated.contacts === 'string' ? updated.contacts : JSON.stringify(updated.contacts || []),
                    contactPersons: typeof updated.contactPersons === 'string' ? updated.contactPersons : JSON.stringify(updated.contactPersons || []),
                    priority: Number(updated.priority) || 0,
                })
                .eq('id', id);

            if (error) throw error;

            const { data: plots } = await supabase.from('plots').select('*');
            return NextResponse.json({ success: true, plots: plots || [] });

        } else if (action === 'delete') {
            const { error } = await supabase
                .from('plots')
                .delete()
                .eq('id', id);

            if (error) throw error;

            const { data: plots } = await supabase.from('plots').select('*');
            return NextResponse.json({ success: true, plots: plots || [] });

        } else if (action === 'addNote') {
            const { data: existing, error: fetchError } = await supabase
                .from('plots')
                .select('notes')
                .eq('id', id)
                .single();

            if (fetchError || !existing) {
                return NextResponse.json({ error: "Plot not found" }, { status: 404 });
            }

            let notes = [];
            try {
                notes = JSON.parse(existing.notes || '[]');
            } catch { notes = []; }

            const newNote = {
                id: Date.now().toString(),
                text: note.text,
                author: note.author || 'Tuntematon',
                timestamp: new Date().toISOString()
            };
            notes.push(newNote);

            const { error } = await supabase
                .from('plots')
                .update({ notes: JSON.stringify(notes) })
                .eq('id', id);

            if (error) throw error;

            const { data: plots } = await supabase.from('plots').select('*');
            return NextResponse.json({ success: true, plots: plots || [] });

        } else if (action === 'addContact') {
            const { data: existing, error: fetchError } = await supabase
                .from('plots')
                .select('contacts')
                .eq('id', id)
                .single();

            if (fetchError || !existing) {
                return NextResponse.json({ error: "Plot not found" }, { status: 404 });
            }

            let contacts = [];
            try {
                contacts = JSON.parse(existing.contacts || '[]');
            } catch { contacts = []; }

            const newContact = {
                ...note,
                id: Date.now().toString(),
                timestamp: new Date().toISOString()
            };
            contacts.push(newContact);

            const { error } = await supabase
                .from('plots')
                .update({ contacts: JSON.stringify(contacts) })
                .eq('id', id);

            if (error) throw error;

            const { data: plots } = await supabase.from('plots').select('*');
            return NextResponse.json({ success: true, plots: plots || [] });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });

    } catch (error: any) {
        console.error("DB Error:", error);
        return NextResponse.json({ error: error.message || "Failed to save data", details: error }, { status: 500 });
    }
}
