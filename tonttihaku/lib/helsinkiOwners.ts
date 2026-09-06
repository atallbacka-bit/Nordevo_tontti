/**
 * Property ownership lookup for Helsinki parcels.
 *
 * Source: Helsingin karttapalvelu (kartta.hel.fi, Sitowise Louhi). The map
 * service's own "Kiinteistöt" → RegistryForm panel reads the city's
 * kiinteistörekisteri through an unauthenticated feature-select API:
 *
 *   POST https://kartta.hel.fi/api-sw/layer/<layer>/feature
 *   { layer, query, maxFeatures, skipFeatures, srs }
 *
 * Layers (site id 1):
 *   RegistryFormLayerSource:RegistryForm_Estate_Point_1     basic estate record (query: ident1=='91-1-591-2')
 *   RegistryFormLayerSource:RegistryForm_EstateOwners_1     owners / lessees   (query: real_estate_ident1=='…')
 *   RegistryFormLayerSource:RegistryForm_ControlUnit_1      hallintayksiköt, i.e. leasehold areas (query: real_estate_ident1=='…')
 *   RegistryFormLayerSource:RegistryForm_ControlUnitOwner_1 lessees of a hallintayksikkö (query: sub_unit_key==N && municipality_db_code==91)
 *   RegistryFormLayerSource:RegistryForm_EstatePlanArea_1   estate → asemakaava links (query: ident1=='…'; gives plan_key, ident = kaavatunnus, real_estate_key)
 *   RegistryFormLayerSource:RegistryForm_PlanArea_1         plan record (query: (plan_key==N&&municipality_db_code==91))
 *   RegistryFormLayerSource:RegistryForm_PlanAreaUnit_1     kaavayksiköt of the estate (query: estate_id==<real_estate_key>): use, area, rakennusoikeus
 *
 * Privacy: the service only publishes owners that are organisations. Natural
 * persons and estates of deceased persons come back with AUTH_STATUS_CODE 403
 * and every field null (Tietosuojalaki 1050/2018). We mirror that and
 * additionally mask anything with owner_type_code 1 (person) on our side.
 *
 * This is the karttapalvelu's internal backend, not a documented open-data
 * interface — keep the call volume low (one parcel per click, cached) and
 * expect it to change without notice.
 */

const SW_BASE = 'https://kartta.hel.fi/api-sw/layer/';
const SITE = 1;
const L_ESTATE = `RegistryFormLayerSource:RegistryForm_Estate_Point_${SITE}`;
const L_OWNERS = `RegistryFormLayerSource:RegistryForm_EstateOwners_${SITE}`;
const L_CONTROL_UNITS = `RegistryFormLayerSource:RegistryForm_ControlUnit_${SITE}`;
const L_CONTROL_UNIT_OWNERS = `RegistryFormLayerSource:RegistryForm_ControlUnitOwner_${SITE}`;
const L_ESTATE_PLANS = `RegistryFormLayerSource:RegistryForm_EstatePlanArea_${SITE}`;
const L_PLAN_AREAS = `RegistryFormLayerSource:RegistryForm_PlanArea_${SITE}`;
const L_PLAN_UNITS = `RegistryFormLayerSource:RegistryForm_PlanAreaUnit_${SITE}`;

export const HELSINKI_MUNICIPALITY = 91;

export interface HkiOwner {
    /** true = natural person / kuolinpesä, hidden by law — no other fields are set */
    masked: boolean;
    name?: string;
    /** 'omistus' (owner) or 'vuokraus' (lessee) as reported by the register */
    ownerType?: string;
    /** Y-tunnus; organisations only */
    businessId?: string;
    homeTown?: string;
    address?: string;
    /** registration share, e.g. "1/1" */
    share?: string;
    /** ISO date of acquisition (saantopäivä) */
    acquired?: string;
    /** ISO date of title registration (lainhuuto) */
    registered?: string;
    registrationSolution?: string;
}

export interface HkiControlUnit {
    key: number;
    /** e.g. "Vuokra-alue" */
    kind: string;
    name?: string;
    areaM2?: number;
    buildings?: number;
    registered?: string;
    owners: HkiOwner[];
}

export interface HkiEstate {
    name?: string;
    address?: string;
    addressSv?: string;
    postal?: string;
    district?: string;
    areaM2?: number;
    registered?: string;
    lots?: number;
    buildings?: number;
}

export interface HkiPlanUnit {
    /** e.g. "91-1-591-2" */
    id: string;
    /** e.g. "tonttirekisteritontti" */
    type?: string;
    state?: string;
    /** käyttötarkoitus abbreviation, e.g. "AK", "YO" */
    order?: string;
    areaM2?: number;
    /** permitted building area, k-m² */
    buildingRightM2?: number;
    planKey?: number;
}

export interface HkiPlan {
    key: number;
    /** kaavatunnus, e.g. "12290" — key for the Kaavadokumentit page */
    tunnus: string;
    name?: string;
    /** e.g. "Asemakaavan muutos" */
    type?: string;
    /** e.g. "voimassa" */
    status?: string;
    /** ISO dates: vahvistettu / voimaan / lainvoimainen */
    sanctioned?: string;
    effective?: string;
    legal?: string;
}

export type OwnershipSummary =
    | 'city'          // Helsingin kaupunki owns, no lease recorded
    | 'city-leased'   // city owns, leased to a third party
    | 'state'         // Suomen valtio / Senaatti
    | 'organisation'  // company, housing company, foundation …
    | 'private'       // only natural persons (all masked)
    | 'mixed'         // organisations and masked persons
    | 'unknown';      // nothing in the register

export interface HkiOwnership {
    /** display form, e.g. "91-1-591-2" */
    tunnus: string;
    /** false for parcels outside Helsinki (the register only covers 091) */
    supported: boolean;
    estate: HkiEstate | null;
    owners: HkiOwner[];
    controlUnits: HkiControlUnit[];
    maskedCount: number;
    summary: OwnershipSummary;
    /** asemakaavat covering the estate, newest first */
    plans: HkiPlan[];
    /** the estate's kaavayksiköt (use + rakennusoikeus) */
    planUnits: HkiPlanUnit[];
    fetchedAt: string;
}

/**
 * Normalise any kiinteistötunnus spelling to the register's ident1 form
 * ("91-1-591-2"): accepts the 14-digit form, the zero-padded dashed form
 * and the display form. Returns null when it isn't a kiinteistötunnus.
 */
export function toIdent1(input: string | null | undefined): string | null {
    if (!input) return null;
    const s = String(input).replace(/\s+/g, '');
    let parts: string[] | null = null;
    if (/^\d{14}$/.test(s)) {
        parts = [s.slice(0, 3), s.slice(3, 6), s.slice(6, 10), s.slice(10, 14)];
    } else if (/^\d{1,3}-\d{1,3}-\d{1,4}-\d{1,4}$/.test(s)) {
        parts = s.split('-');
    }
    if (!parts) return null;
    const nums = parts.map(p => parseInt(p, 10));
    if (nums.some(n => !Number.isFinite(n))) return null;
    return nums.join('-');
}

export function municipalityOf(ident1: string): number {
    return parseInt(ident1.split('-')[0], 10);
}

async function swQuery(layer: string, query: string, maxFeatures = 50, signal?: AbortSignal): Promise<any[]> {
    const res = await fetch(`${SW_BASE}${layer}/feature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ layer, query, maxFeatures, skipFeatures: 0, srs: 'EPSG:3879' }),
        signal,
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`kartta.hel.fi ${layer}: HTTP ${res.status}`);
    // responses carry a UTF-8 BOM
    const text = (await res.text()).replace(/^\uFEFF/, '');
    const json = JSON.parse(text);
    return (json.features || []).map((f: any) => f.properties || {});
}

const str = (v: any): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));
const num = (v: any): number | undefined => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

function mapOwner(p: any): HkiOwner {
    const auth = Number(p.AUTH_STATUS_CODE ?? p.auth_status_code ?? 200);
    const typeCode = Number(p.owner_type_code);
    const name = [p.firstnames, p.lastname].filter(Boolean).join(' ').trim();
    // 403 = hidden by the service; type 1 = natural person — never show either
    if (auth !== 200 || typeCode === 1 || !name) return { masked: true };
    return {
        masked: false,
        name,
        ownerType: str(p.owner_type_fi),
        businessId: typeCode === 2 ? str(p.social_id) : undefined,
        homeTown: str(p.home_town_fi),
        address: str(p.person_address_fi),
        share: str(p.registration_share),
        acquired: str(p.date_of_acquisition),
        registered: str(p.date_of_registration),
        registrationSolution: str(p.registration_solution_fi),
    };
}

function mapEstate(p: any): HkiEstate {
    return {
        name: str(p.estate_name),
        address: str(p.address_fi),
        addressSv: str(p.address_sv),
        postal: str(p.post_fi),
        district: str(p.district_name_fi),
        areaM2: num(p.total_area),
        registered: str(p.date_registered),
        lots: num(p.lot_count),
        buildings: num(p.building_count),
    };
}

function mapPlan(p: any): HkiPlan {
    return {
        key: Number(p.plan_key),
        tunnus: String(p.ident ?? '').trim(),
        name: str(p.plan_name)?.trim() || undefined,
        type: str(p.plan_type_fi),
        status: str(p.status_fi),
        sanctioned: str(p.date_sanctioned),
        effective: str(p.date_effective),
        legal: str(p.date_legal),
    };
}

function mapPlanUnit(p: any): HkiPlanUnit {
    return {
        id: String(p.plan_unit_id ?? ''),
        type: str(p.plan_unit_type),
        state: str(p.plan_unit_state),
        order: str(p.plan_unit_order_abb),
        areaM2: num(p.plan_unit_area),
        buildingRightM2: num(p.plan_unit_perm_buil_area),
        planKey: num(p.plan_key),
    };
}

/**
 * The clicked plot's plan unit(s) and the plan(s) governing them. Fails soft:
 * [] on error.
 *
 * The register links plan units to the estate by key, which also brings in
 * units of other plots the estate was formed from (street units such as
 * 91-20-9901-0), and it links every plan that touches the estate. Only the
 * clicked plot's own unit is shown, and only the plan that unit belongs to;
 * when no unit matches, fall back to the linked plans without units.
 */
async function fetchPlans(ident1: string, signal?: AbortSignal): Promise<{ plans: HkiPlan[]; planUnits: HkiPlanUnit[] }> {
    const links = await swQuery(L_ESTATE_PLANS, `ident1=='${ident1}'`, 50, signal).catch(() => [] as any[]);
    const estateKey = links.map(l => Number(l.real_estate_key)).find(k => Number.isFinite(k));
    const unitRows = estateKey !== undefined
        ? await swQuery(L_PLAN_UNITS, `estate_id==${estateKey}`, 50, signal).catch(() => [] as any[])
        : [];

    const allUnits = unitRows.map(mapPlanUnit).filter(u => u.id);
    let ownUnits = allUnits.filter(u => u.id === ident1);
    if (ownUnits.some(u => u.state && /voimassa/i.test(u.state))) {
        ownUnits = ownUnits.filter(u => u.state && /voimassa/i.test(u.state));
    }
    const governingKeys = new Set(ownUnits.map(u => u.planKey).filter((k): k is number => k != null));
    const linkKeys = links.map(l => Number(l.plan_key)).filter(k => Number.isFinite(k));
    const keys = Array.from(new Set(governingKeys.size ? Array.from(governingKeys) : linkKeys));

    const planRows = await Promise.all(keys.map(k =>
        swQuery(L_PLAN_AREAS, `(plan_key==${k}&&municipality_db_code==${HELSINKI_MUNICIPALITY})`, 1, signal).catch(() => [] as any[])
    )).then(rows => rows.flat());

    const plans = planRows.map(mapPlan).filter(p => p.tunnus);
    // a link without a plan record still identifies the plan (kaavatunnus)
    for (const l of links) {
        const key = Number(l.plan_key);
        if (keys.includes(key) && l.ident && !plans.some(p => p.key === key)) {
            plans.push({ key, tunnus: String(l.ident).trim(), type: str(l.plan_type_fi) });
        }
    }
    plans.sort((a, b) => (b.sanctioned || '').localeCompare(a.sanctioned || ''));
    return { plans, planUnits: ownUnits };
}

const isCity = (n?: string) => !!n && /^helsingin kaupunki/i.test(n);
const isState = (n?: string) => !!n && /(^suomen valtio|senaatti)/i.test(n);

export function summarise(owners: HkiOwner[], controlUnits: HkiControlUnit[]): OwnershipSummary {
    if (!owners.length) return 'unknown';
    const titleHolders = owners.filter(o => !o.masked && (!o.ownerType || /omistus/i.test(o.ownerType)));
    const hasLease = owners.some(o => !!o.ownerType && /vuokra/i.test(o.ownerType))
        || controlUnits.some(c => /vuokra/i.test(c.kind) && c.owners.length > 0);
    if (titleHolders.some(o => isCity(o.name))) return hasLease ? 'city-leased' : 'city';
    if (titleHolders.some(o => isState(o.name))) return 'state';
    const masked = owners.filter(o => o.masked).length;
    if (masked === owners.length) return 'private';
    if (masked > 0) return 'mixed';
    return 'organisation';
}

/**
 * Fetch the register record for one Helsinki parcel. `ident1` must already be
 * normalised with toIdent1(); the query language is the service's own, so the
 * strict format check doubles as injection protection.
 */
export async function fetchHelsinkiOwnership(ident1: string, signal?: AbortSignal): Promise<HkiOwnership> {
    if (!/^\d{1,3}-\d{1,3}-\d{1,4}-\d{1,4}$/.test(ident1)) throw new Error('invalid kiinteistötunnus');
    const fetchedAt = new Date().toISOString();
    if (municipalityOf(ident1) !== HELSINKI_MUNICIPALITY) {
        return { tunnus: ident1, supported: false, estate: null, owners: [], controlUnits: [], maskedCount: 0, summary: 'unknown', plans: [], planUnits: [], fetchedAt };
    }

    const [estateRows, ownerRows, unitRows, planData] = await Promise.all([
        swQuery(L_ESTATE, `ident1=='${ident1}'`, 1, signal).catch(() => [] as any[]),
        swQuery(L_OWNERS, `real_estate_ident1=='${ident1}'`, 50, signal),
        swQuery(L_CONTROL_UNITS, `real_estate_ident1=='${ident1}'`, 50, signal).catch(() => [] as any[]),
        fetchPlans(ident1, signal).catch(() => ({ plans: [] as HkiPlan[], planUnits: [] as HkiPlanUnit[] })),
    ]);

    const controlUnits: HkiControlUnit[] = await Promise.all(
        unitRows
            .filter(u => Number.isFinite(Number(u.sub_unit_key)))
            .map(async (u): Promise<HkiControlUnit> => {
                const key = Number(u.sub_unit_key);
                const owners = await swQuery(
                    L_CONTROL_UNIT_OWNERS,
                    `sub_unit_key==${key} && municipality_db_code==${HELSINKI_MUNICIPALITY}`,
                    50,
                    signal,
                ).then(rows => rows.map(mapOwner)).catch(() => [] as HkiOwner[]);
                return {
                    key,
                    kind: str(u.sub_ident_fi) || 'Hallintayksikkö',
                    name: str(u.name),
                    areaM2: num(u.total_area),
                    buildings: num(u.building_count),
                    registered: str(u.date_registered),
                    owners,
                };
            })
    );

    const owners = ownerRows.map(mapOwner);
    return {
        tunnus: ident1,
        supported: true,
        estate: estateRows.length ? mapEstate(estateRows[0]) : null,
        owners,
        controlUnits,
        maskedCount: owners.filter(o => o.masked).length,
        summary: summarise(owners, controlUnits),
        plans: planData.plans,
        planUnits: planData.planUnits,
        fetchedAt,
    };
}
