import { PlotData, ZoningEntry, Note, ContactLog, ContactPerson } from '@/types';

// Parse zonings from JSON string or legacy format
export function parseZonings(plot: PlotData): ZoningEntry[] {
    if (plot.zonings) {
        try {
            const parsed = typeof plot.zonings === 'string' ? JSON.parse(plot.zonings) : plot.zonings;
            if (Array.isArray(parsed)) return parsed;
        } catch { }
    }
    return [{ type: 'AK', buildingRight: plot.buildingRight || 0 }];
}

// Parse notes from JSON string
export function parseNotes(plot: PlotData): Note[] {
    if (plot.notes) {
        try {
            const parsed = typeof plot.notes === 'string' ? JSON.parse(plot.notes) : plot.notes;
            if (Array.isArray(parsed)) return parsed;
        } catch { }
    }
    return [];
}

// Parse contact logs from JSON string
export function parseContacts(plot: PlotData): ContactLog[] {
    if (plot.contacts) {
        try {
            const parsed = typeof plot.contacts === 'string' ? JSON.parse(plot.contacts) : plot.contacts;
            if (Array.isArray(parsed)) return parsed;
        } catch { }
    }
    return [];
}

// Parse contact persons (with legacy field fallback)
export function getContactPersons(plot: PlotData): ContactPerson[] {
    try {
        if (plot.contactPersons) {
            const parsed = typeof plot.contactPersons === 'string' ? JSON.parse(plot.contactPersons) : plot.contactPersons;
            if (Array.isArray(parsed)) return parsed;
        }
        if (plot.contactPerson) {
            return [{
                id: 'legacy',
                name: plot.contactPerson,
                phone: plot.contactPhone,
                email: plot.contactEmail
            }];
        }
    } catch (e) {
        console.error('Error parsing contact persons:', e);
    }
    return [];
}

// Format date for display
export function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
        return new Date(dateStr).toLocaleDateString('fi-FI');
    } catch {
        return dateStr;
    }
}

// Short day.month format for chips and markers, e.g. "29.8."
export function formatShortDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        return `${d.getDate()}.${d.getMonth() + 1}.`;
    } catch {
        return dateStr;
    }
}

// Compact price for stat tiles: 3 600 000 -> "3,60 M€", 480 000 -> "480 t€"
export function formatCompactPrice(value?: number | null): string | null {
    if (!value) return null;
    if (value >= 1_000_000) {
        const m = value / 1_000_000;
        const digits = Number.isInteger(m) ? 0 : (m >= 10 ? 1 : 2);
        return `${m.toLocaleString('fi-FI', { minimumFractionDigits: digits, maximumFractionDigits: digits })} M€`;
    }
    if (value >= 100_000) {
        return `${Math.round(value / 1000).toLocaleString('fi-FI')} t€`;
    }
    return `${value.toLocaleString('fi-FI')} €`;
}
