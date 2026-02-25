import { PlotData, PlotApiResponse, AuthResponse, ContactLog } from '@/types';

// ─── Plots ───────────────────────────────────────────────────

export async function fetchPlots(): Promise<PlotData[]> {
    const res = await fetch('/api/plots');
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

export async function savePlot(
    plot: Partial<PlotData>,
    action: 'add' | 'update'
): Promise<PlotApiResponse> {
    const res = await fetch('/api/plots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, plot, id: plot.id }),
    });
    return res.json();
}

export async function deletePlot(id: string): Promise<PlotApiResponse> {
    const res = await fetch('/api/plots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
    });
    return res.json();
}

export async function addNote(
    plotId: string,
    note: { text: string; author: string }
): Promise<PlotApiResponse> {
    const res = await fetch('/api/plots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addNote', id: plotId, note }),
    });
    return res.json();
}

export async function addContactLog(
    plotId: string,
    log: Partial<ContactLog>
): Promise<PlotApiResponse> {
    const res = await fetch('/api/plots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addContact', id: plotId, note: log }),
    });
    return res.json();
}

// ─── Apartments ──────────────────────────────────────────────

export async function fetchApartments(): Promise<unknown[]> {
    const res = await fetch('/api/apartments');
    if (!res.ok) throw new Error('Failed to fetch apartments');
    return res.json();
}

// ─── Export ──────────────────────────────────────────────────

export async function exportPlots(plotIds: string[]): Promise<Blob> {
    const res = await fetch('/api/export-plots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plotIds }),
    });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
}

// ─── Auth ────────────────────────────────────────────────────

export async function login(password: string): Promise<AuthResponse> {
    const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
    });
    return res.json();
}
