export interface ZoningEntry {
    type: string;
    buildingRight: number;
}

// New Contact Person Interface
export interface ContactPerson {
    id: string; // Unique ID for contact person
    name: string;
    phone?: string;
    email?: string;
    role?: string;
}

export interface Note {
    id: string;
    text: string;
    author: string;
    timestamp: string;
}

export interface PlotData {
    id: string;
    name: string;
    area: number;
    priceEst?: number; // Changed to optional
    desc?: string;
    seller?: string;
    status: string; // Vapaa, Kilpailussa, Mennyt, Tarjottu, Pidossa
    // Data is stored as JSON string in DB, parsed in frontend.
    // Ideally this should be normalized, but keeping string for compatibility with existing flow for now.
    zonings: string; // JSON string of ZoningEntry[]
    buildingRight: number;
    deadline?: string;
    address?: string;
    kunta?: string;
    kiinteistotunnus?: string;

    // Geo
    lat: number;
    lng: number;

    // System fields
    createdAt: string;
    createdBy: string;
    updatedAt?: string;
    updatedBy?: string;

    // Notes
    notes: string; // JSON string of Note[] (was optional, now required as per Code Edit, but keeping original optionality as per instruction to not make unrelated edits unless specified)

    // Legacy/Sales fields
    buyer?: string;
    finalPrice?: number;
    soldDate?: string;
    pricePerRight?: number; // Kept as it was not explicitly removed

    // Offer fields
    offerPrice?: number;
    offerDate?: string;
    offerDesc?: string;

    // Contact fields (Legacy - migrate to contactPersons)
    contactPerson?: string;
    contactPhone?: string;
    contactEmail?: string;

    // New Contact Fields
    contactPersons?: string; // JSON string of ContactPerson[]
    contacts?: string; // JSON string of ContactLog[]

    // Priority Rating (1-3, 0 means unrated)
    priority?: number;

    // Construction material potential: 'Puu' | 'Betoni' | '' (unknown)
    material?: string;
}

export interface ContactLog {
    id: string;
    date: string;
    method: string; // Phone, Email, Meeting, Other
    person: string; // Who was contacted
    agent: string; // Who from our side contacted
    desc: string;
    outcome?: string; // Optional outcome summary
    timestamp: string; // System timestamp
}

export interface PlotFilters {
    zoningTypes: string[];
    buildingRightMin: string;
    buildingRightMax: string;
    status: string;
    kunnat: string[];
    priorities: number[];
    materials: string[];
}

export interface SalesFilters {
    zoningTypes: string[];
    buildingRightMin: string;
    buildingRightMax: string;
}

export interface BusinessPlotFilters {
    minArea: string;
    maxArea: string;
    minBuildRight: string;
    maxBuildRight: string;
    usage: string[];
}

// API request/response types
export type PlotAction = 'add' | 'update' | 'delete' | 'addNote' | 'addContact';

export interface PlotApiRequest {
    action: PlotAction;
    plot?: Partial<PlotData>;
    id?: string;
    note?: Partial<Note> | Partial<ContactLog>;
}

export interface PlotApiResponse {
    success?: boolean;
    plots?: PlotData[];
    error?: string;
}

export interface MarkSoldData {
    buyer: string;
    finalPrice: number;
    pricePerRight: number;
    soldDate: string;
    desc: string;
    updatedBy: string;
}

export interface MarkOfferedData {
    offerPrice: number;
    offerDate: string;
    desc: string;
    updatedBy: string;
}

export interface AuthResponse {
    success?: boolean;
    token?: string;
    error?: string;
}
