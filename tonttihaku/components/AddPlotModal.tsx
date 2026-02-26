"use client";
import React, { useState, useEffect } from 'react';
import { ZONING_TYPES, getZoningColor, STATUS_OPTIONS, KUNTA_OPTIONS } from '@/lib/constants';
import { ZoningEntry, PlotData } from '@/types';
import { useAuth } from '@/components/AuthProvider';



interface AddPlotModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (plot: any, action: 'add' | 'update') => void;
    location?: { lat: number, lng: number } | null;
    mode?: 'add' | 'edit';
    existingPlot?: PlotData | null;
}

export default function AddPlotModal({
    isOpen,
    onClose,
    onSave,
    location,
    mode = 'add',
    existingPlot = null
}: AddPlotModalProps) {
    const { username } = useAuth();
    const [formData, setFormData] = useState({
        name: '',
        area: '',
        pricePerRight: '',
        desc: '',
        seller: '',
        status: 'Vapaa',
        deadline: '',
        address: '',
        kunta: 'Helsinki',
        kiinteistotunnus: '',
        createdBy: '',
        updatedBy: '',
        // Sold fields
        buyer: '',
        finalPrice: '',
        soldDate: new Date().toISOString().split('T')[0],
        // Contact fields
        contactPerson: '',
        contactPhone: '',
        contactEmail: '',
        priority: 0 // New Priority Field
    });

    // New state for initial contact log
    const [hasContacted, setHasContacted] = useState(false);
    const [contactLog, setContactLog] = useState({
        date: new Date().toISOString().split('T')[0],
        desc: '',
        personId: ''
    });

    // Contact Persons State
    const [contactPersons, setContactPersons] = useState<{ id: string, name: string, phone: string, email: string }[]>([
        { id: '1', name: '', phone: '', email: '' }
    ]);

    const [zonings, setZonings] = useState<ZoningEntry[]>([{ type: 'AK', buildingRight: 0 }]);

    useEffect(() => {
        if (isOpen) {
            setHasContacted(false);
            setContactLog({ date: new Date().toISOString().split('T')[0], desc: '', personId: '' });

            if (mode === 'edit' && existingPlot) {
                // Prefill form with existing data
                let parsedZonings: ZoningEntry[] = [{ type: 'AK', buildingRight: 0 }];
                let parsedContacts = [];
                try {
                    if (existingPlot.contactPersons) {
                        parsedContacts = JSON.parse(existingPlot.contactPersons);
                    } else if (existingPlot.contactPerson) {
                        // Migration from legacy
                        parsedContacts = [{
                            id: 'legacy',
                            name: existingPlot.contactPerson,
                            phone: existingPlot.contactPhone || '',
                            email: existingPlot.contactEmail || ''
                        }];
                    }
                } catch { }

                if (parsedContacts.length === 0) parsedContacts = [{ id: '1', name: '', phone: '', email: '' }];
                setContactPersons(parsedContacts);

                try {
                    if (existingPlot.zonings) {
                        const parsed = typeof existingPlot.zonings === 'string'
                            ? JSON.parse(existingPlot.zonings)
                            : existingPlot.zonings;
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            parsedZonings = parsed;
                        }
                    }
                } catch { /* use default */ }

                setFormData({
                    name: existingPlot.name || '',
                    area: existingPlot.area?.toString() || '',
                    pricePerRight: existingPlot.pricePerRight?.toString() || (existingPlot.priceEst && existingPlot.buildingRight ? Math.round(existingPlot.priceEst / existingPlot.buildingRight).toString() : ''),
                    desc: existingPlot.desc || '',
                    seller: existingPlot.seller || '',
                    status: existingPlot.status || 'Vapaa',
                    deadline: existingPlot.deadline || '',
                    address: existingPlot.address || '',
                    kunta: existingPlot.kunta || 'Helsinki',
                    kiinteistotunnus: existingPlot.kiinteistotunnus || '',
                    createdBy: existingPlot.createdBy || '',
                    updatedBy: username || '',
                    buyer: existingPlot.buyer || '',
                    finalPrice: existingPlot.finalPrice?.toString() || '',
                    soldDate: existingPlot.soldDate || new Date().toISOString().split('T')[0],
                    // Legacy fields cleared from form data as we use contactPersons state
                    contactPerson: '', contactPhone: '', contactEmail: '',
                    priority: existingPlot.priority || 0
                });
                setZonings(parsedZonings);
            } else {
                // Reset for add mode
                setFormData({
                    name: '', area: '', pricePerRight: '',
                    desc: '', seller: '', status: 'Vapaa',
                    deadline: '', address: '', kunta: 'Helsinki', kiinteistotunnus: '', createdBy: username || '', updatedBy: '',
                    buyer: '', finalPrice: '', soldDate: new Date().toISOString().split('T')[0],
                    contactPerson: '', contactPhone: '', contactEmail: '',
                    priority: 0
                });
                setZonings([{ type: 'AK', buildingRight: 0 }]);
                setContactPersons([{ id: '1', name: '', phone: '', email: '' }]);
            }
        }
    }, [isOpen, mode, existingPlot]);

    if (!isOpen) return null;

    const totalBuildingRight = zonings.reduce((sum, z) => sum + (z.buildingRight || 0), 0);
    const isEditMode = mode === 'edit';
    const availableStatusOptions = isEditMode ? STATUS_OPTIONS : STATUS_OPTIONS.filter(opt => opt.value !== 'Mennyt');

    const updateContactPerson = (index: number, field: string, value: string) => {
        const updated = [...contactPersons];
        updated[index] = { ...updated[index], [field]: value };
        setContactPersons(updated);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // Filter out empty contacts
        const validContacts = contactPersons.filter(c => c.name.trim() !== '');

        const plotData: any = {
            ...formData,
            zonings: JSON.stringify(zonings),
            buildingRight: totalBuildingRight,
            area: parseInt(formData.area) || 0,
            priceEst: totalBuildingRight * (parseInt(formData.pricePerRight) || 0),
            pricePerRight: parseInt(formData.pricePerRight) || 0,
            contactPersons: JSON.stringify(validContacts),
            // Maintain legacy for compatibility if needed, but primary is now contactPersons
            contactPerson: validContacts[0]?.name || '',
            contactPhone: validContacts[0]?.phone || '',
            contactEmail: validContacts[0]?.email || '',
            priority: Number(formData.priority) || 0
        };

        // Handle initial contact log
        if (!isEditMode && hasContacted) {
            let selectedPerson = validContacts[0];
            if (contactLog.personId) {
                selectedPerson = validContacts.find(p => p.id === contactLog.personId) || selectedPerson;
            }

            const newContactLog = {
                id: Date.now().toString(),
                date: contactLog.date,
                desc: contactLog.desc,
                agent: formData.createdBy,
                person: selectedPerson?.name || 'Ei määritelty',
                personId: selectedPerson?.id,
                method: 'Muu',
                timestamp: new Date().toISOString()
            };
            plotData.contacts = JSON.stringify([newContactLog]);
        }

        if (isEditMode && existingPlot) {
            // Update existing plot
            plotData.id = existingPlot.id;
            plotData.updatedBy = formData.updatedBy || formData.createdBy;
            plotData.createdAt = existingPlot.createdAt;
            plotData.createdBy = existingPlot.createdBy;
            plotData.lat = existingPlot.lat;
            plotData.lng = existingPlot.lng;
            plotData.notes = existingPlot.notes;
            plotData.contacts = existingPlot.contacts; // Preserve existing contacts in update (init contact only for add)
            onSave(plotData, 'update');
        } else {
            // Add new plot
            plotData.lat = location?.lat;
            plotData.lng = location?.lng;
            onSave(plotData, 'add');
        }
        onClose();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const updateZoning = (index: number, field: keyof ZoningEntry, value: string | number) => {
        const updated = [...zonings];
        if (field === 'buildingRight') {
            updated[index][field] = parseInt(value as string) || 0;
        } else {
            updated[index][field] = value as string;
        }
        setZonings(updated);
    };

    const addZoning = () => {
        setZonings([...zonings, { type: 'AK', buildingRight: 0 }]);
    };

    const removeZoning = (index: number) => {
        if (zonings.length > 1) {
            setZonings(zonings.filter((_, i) => i !== index));
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
        >
            <div className="bg-white p-6 rounded-lg shadow-xl w-[500px] max-w-full max-h-[90vh] overflow-y-auto relative">
                {/* Close button */}
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
                    aria-label="Sulje"
                >
                    ×
                </button>

                <h2 className="text-xl font-bold mb-4 pr-8">
                    {isEditMode ? 'Muokkaa tonttia' : 'Lisää tunnettu tontti'}
                </h2>

                {/* Location info */}
                <div className="mb-4 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                    {isEditMode && existingPlot ? (
                        <span>Sijainti: {existingPlot.lat?.toFixed(5)}, {existingPlot.lng?.toFixed(5)}</span>
                    ) : location ? (
                        <span>Sijainti: {location.lat.toFixed(5)}, {location.lng.toFixed(5)}</span>
                    ) : (
                        <span>Sijaintia ei määritetty</span>
                    )}
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    {/* ESSENTIAL FIELDS - Always visible */}
                    <div className="grid grid-cols-2 gap-3">
                        {/* Name field */}
                        <div className="col-span-2">
                            <label className="block text-xs font-semibold text-gray-700 uppercase">Nimi *</label>
                            <input name="name" type="text" required value={formData.name} onChange={handleChange}
                                className="w-full border rounded p-2 text-sm" placeholder="Esim. Tontti A" />
                        </div>

                        {/* Added by / Updated by field */}
                        <div className="col-span-2 bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                            <label className="block text-xs font-semibold text-gray-700 uppercase">
                                {isEditMode ? 'Muokkaajan nimi *' : 'Lisääjän nimi *'}
                            </label>
                            <input
                                name={isEditMode ? 'updatedBy' : 'createdBy'}
                                type="text"
                                required
                                value={isEditMode ? formData.updatedBy : formData.createdBy}
                                onChange={handleChange}
                                className="w-full border rounded p-2 text-sm"
                                placeholder="Oma nimesi"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Nimi tallentuu automaattisesti aikaleiman kanssa.
                            </p>
                        </div>

                        {/* Zoning Types Section */}
                        <div className="col-span-2 bg-blue-50 p-3 rounded-lg border border-blue-200">
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-xs font-semibold text-gray-700 uppercase">Kaavatyypit ja rakennusoikeus</label>
                                <button type="button" onClick={addZoning} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">
                                    + Lisää tyyppi
                                </button>
                            </div>
                            <div className="space-y-2">
                                {zonings.map((zoning, index) => (
                                    <div key={index} className="flex items-center gap-2 bg-white p-2 rounded border">
                                        <select
                                            value={zoning.type}
                                            onChange={(e) => updateZoning(index, 'type', e.target.value)}
                                            className="flex-1 border rounded p-1.5 text-sm"
                                            style={{ borderLeftColor: getZoningColor(zoning.type), borderLeftWidth: '4px' }}
                                        >
                                            {ZONING_TYPES.map(z => (
                                                <option key={z.code} value={z.code}>{z.code} - {z.label}</option>
                                            ))}
                                        </select>
                                        <input
                                            type="number"
                                            value={zoning.buildingRight || ''}
                                            onChange={(e) => updateZoning(index, 'buildingRight', e.target.value)}
                                            className="w-24 border rounded p-1.5 text-sm text-right"
                                            placeholder="k-m²"
                                        />
                                        <span className="text-xs text-gray-500">k-m²</span>
                                        {zonings.length > 1 && (
                                            <button type="button" onClick={() => removeZoning(index)} className="text-red-500 hover:text-red-700 p-1">
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="mt-2 pt-2 border-t border-blue-200 text-right">
                                <span className="text-sm font-semibold text-gray-700">Yhteensä: {totalBuildingRight.toLocaleString()} k-m²</span>
                            </div>
                        </div>

                        {/* Price estimate - essential */}
                        <div className="col-span-2 grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Kem hinta-arvio *</label>
                                <div className="relative">
                                    <input name="pricePerRight" type="number" required value={formData.pricePerRight} onChange={handleChange}
                                        className="w-full border rounded p-2 text-sm pr-12" placeholder="0" />
                                    <span className="absolute right-3 top-2 text-xs text-gray-500">€/k-m²</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Laskettu kokonaisarvio</label>
                                <div className="w-full border rounded p-2 text-sm bg-gray-100 text-gray-600">
                                    {(totalBuildingRight * (parseInt(formData.pricePerRight) || 0)).toLocaleString()} €
                                </div>
                            </div>
                        </div>

                        {/* Priority field - essential */}
                        <div className="col-span-2">
                            <label className="block text-xs font-semibold text-gray-700 uppercase">Prioriteetti</label>
                            <select name="priority" value={formData.priority} onChange={handleChange} className="w-full border rounded p-2 text-sm bg-white">
                                <option value={0}>- Ei luokiteltu -</option>
                                <option value={1}>1 - Korkea prioriteetti</option>
                                <option value={2}>2 - Keskikorkea prioriteetti</option>
                                <option value={3}>3 - Matala prioriteetti</option>
                            </select>
                            <p className="text-xs text-gray-500 mt-1">1 = korkea, 3 = matala</p>
                        </div>

                        {/* Description - essential */}
                        <div className="col-span-2">
                            <label className="block text-xs font-semibold text-gray-700 uppercase">Kuvaus</label>
                            <textarea name="desc" rows={2} value={formData.desc} onChange={handleChange} className="w-full border rounded p-2 text-sm" placeholder="Lisätietoja..." />
                        </div>
                    </div>

                    {/* ADDITIONAL FIELDS - Always visible */}
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t mt-2">
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase">Myyjä</label>
                            <input name="seller" type="text" value={formData.seller} onChange={handleChange} className="w-full border rounded p-2 text-sm" placeholder="Esim. Helsingin Kaupunki" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase">Pinta-ala (m²)</label>
                            <input name="area" type="number" value={formData.area} onChange={handleChange} className="w-full border rounded p-2 text-sm" placeholder="1200" />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase">Tila</label>
                            <select name="status" value={formData.status} onChange={handleChange} className="w-full border rounded p-2 text-sm">
                                {availableStatusOptions.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase">Osoite</label>
                            <input name="address" type="text" value={formData.address} onChange={handleChange} className="w-full border rounded p-2 text-sm" placeholder="Katuosoite" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase">Kiinteistötunnus</label>
                            <input name="kiinteistotunnus" type="text" value={formData.kiinteistotunnus} onChange={handleChange} className="w-full border rounded p-2 text-sm" placeholder="Esim. 091-001-0001-0001" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase">Kunta</label>
                            <input
                                name="kunta"
                                type="text"
                                list="kunta-suggestions"
                                value={formData.kunta}
                                onChange={handleChange}
                                className="w-full border rounded p-2 text-sm"
                                placeholder="Esim. Helsinki"
                            />
                            <datalist id="kunta-suggestions">
                                {KUNTA_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value} />
                                ))}
                            </datalist>
                        </div>

                        {/* Deadline field - only shown when status is Kilpailussa */}
                        {formData.status === 'Kilpailussa' && (
                            <div className="col-span-2 bg-orange-50 p-3 rounded-lg border border-orange-200">
                                <label className="block text-xs font-semibold text-orange-700 uppercase">Kilpailun deadline *</label>
                                <input
                                    name="deadline"
                                    type="date"
                                    required
                                    value={formData.deadline}
                                    onChange={handleChange}
                                    className="w-full border rounded p-2 text-sm"
                                />
                            </div>
                        )}

                        {/* Contact Persons Section */}
                        <div className="col-span-2 pt-2 border-t mt-2">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-sm font-bold text-gray-800">Yhteystiedot</h3>
                                <button
                                    type="button"
                                    onClick={() => setContactPersons([...contactPersons, { id: Date.now().toString(), name: '', phone: '', email: '' }])}
                                    className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-200 hover:bg-blue-100"
                                >
                                    + Lisää henkilö
                                </button>
                            </div>

                            <div className="space-y-3">
                                {contactPersons.map((person, idx) => (
                                    <div key={person.id} className="bg-gray-50 p-2 rounded border border-gray-200 relative">
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="col-span-2">
                                                <input
                                                    type="text"
                                                    value={person.name}
                                                    onChange={(e) => updateContactPerson(idx, 'name', e.target.value)}
                                                    className="w-full border rounded p-1.5 text-xs font-semibold"
                                                    placeholder="Yhteyshenkilö *"
                                                />
                                            </div>
                                            <div>
                                                <input
                                                    type="text"
                                                    value={person.phone}
                                                    onChange={(e) => updateContactPerson(idx, 'phone', e.target.value)}
                                                    className="w-full border rounded p-1.5 text-xs"
                                                    placeholder="Puhelin"
                                                />
                                            </div>
                                            <div>
                                                <input
                                                    type="email"
                                                    value={person.email}
                                                    onChange={(e) => updateContactPerson(idx, 'email', e.target.value)}
                                                    className="w-full border rounded p-1.5 text-xs"
                                                    placeholder="Sähköposti"
                                                />
                                            </div>
                                        </div>
                                        {contactPersons.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => setContactPersons(contactPersons.filter((_, i) => i !== idx))}
                                                className="absolute -top-1 -right-1 bg-red-100 text-red-600 rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-200"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Initial Contact Log */}
                        {!isEditMode && (
                            <div className="col-span-2 pt-2 border-t mt-2">
                                <div className="flex items-center gap-2 mb-2">
                                    <input
                                        type="checkbox"
                                        id="hasContacted"
                                        checked={hasContacted}
                                        onChange={(e) => setHasContacted(e.target.checked)}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <label htmlFor="hasContacted" className="text-sm font-bold text-gray-800 select-none cursor-pointer">
                                        Onko jo kontaktoitu?
                                    </label>
                                </div>

                                {hasContacted && (
                                    <div className="bg-green-50 p-3 rounded-lg border border-green-200 grid grid-cols-2 gap-3">
                                        <div className="col-span-2">
                                            <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Kenen kanssa?</label>
                                            {contactPersons.length > 0 && contactPersons[0].name ? (
                                                <select
                                                    value={contactLog.personId || contactPersons[0].id} // Default to first
                                                    onChange={(e) => setContactLog({ ...contactLog, personId: e.target.value })}
                                                    className="w-full border rounded p-2 text-sm bg-white"
                                                >
                                                    {contactPersons.filter(p => p.name).map(p => (
                                                        <option key={p.id} value={p.id}>{p.name}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <p className="text-xs text-red-500 italic">Lisää ensin yhteyshenkilö ylle.</p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-700 uppercase">Päivämäärä *</label>
                                            <input
                                                type="date"
                                                value={contactLog.date}
                                                onChange={(e) => setContactLog({ ...contactLog, date: e.target.value })}
                                                className="w-full border rounded p-2 text-sm"
                                                required
                                            />
                                        </div>
                                        {/* Agent field removed as it uses the Creator name */}
                                        <div className="col-span-2">
                                            <label className="block text-xs font-semibold text-gray-700 uppercase">Kommentti *</label>
                                            <textarea
                                                rows={2}
                                                value={contactLog.desc}
                                                onChange={(e) => setContactLog({ ...contactLog, desc: e.target.value })}
                                                className="w-full border rounded p-2 text-sm"
                                                placeholder="Mitä sovittiin..."
                                                required
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* SOLD - Mennyt fields */}
                        {formData.status === 'Mennyt' && (
                            <div className="col-span-2 bg-gray-100 p-3 rounded-lg border border-gray-300">
                                <h3 className="text-sm font-bold text-gray-800 mb-2">Myyntitiedot</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="col-span-2">
                                        <label className="block text-xs font-semibold text-gray-700 uppercase">Ostaja *</label>
                                        <input
                                            name="buyer"
                                            type="text"
                                            required
                                            value={formData.buyer}
                                            onChange={handleChange}
                                            className="w-full border rounded p-2 text-sm"
                                            placeholder="Ostajan nimi / Yritys"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-700 uppercase">Kauppahinta (€) *</label>
                                        <input
                                            name="finalPrice"
                                            type="number"
                                            required
                                            value={formData.finalPrice}
                                            onChange={handleChange}
                                            className="w-full border rounded p-2 text-sm"
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-700 uppercase">Kauppapäivä *</label>
                                        <input
                                            name="soldDate"
                                            type="date"
                                            required
                                            value={formData.soldDate}
                                            onChange={handleChange}
                                            className="w-full border rounded p-2 text-sm"
                                        />
                                    </div>
                                    <div className="col-span-2 text-xs text-gray-500 italic">
                                        Tämä lisää tontin myös "Myydyt tontit" -listaan.
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end space-x-3 pt-4 border-t">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50">Peruuta</button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700">
                            {isEditMode ? 'Päivitä' : 'Tallenna'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
