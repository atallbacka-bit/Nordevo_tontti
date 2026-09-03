"use client";
import React, { useState, useEffect } from 'react';
import { ZONING_TYPES, getZoningColor } from '@/lib/constants';
import { ZoningEntry } from '@/types';
import { useAuth } from '@/components/AuthProvider';
import { useT } from '@/lib/i18n';

interface AddPastPlotModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (plot: any, action: 'add') => void;
    location?: { lat: number, lng: number } | null;
}

export default function AddPastPlotModal({
    isOpen,
    onClose,
    onSave,
    location
}: AddPastPlotModalProps) {
    const t = useT();
    const { username } = useAuth();
    const [formData, setFormData] = useState({
        name: '',
        createdBy: '',
        buyer: '',
        pricePerRight: '', // Kem sales price
        soldDate: new Date().toISOString().split('T')[0],
        desc: ''
    });

    const [zonings, setZonings] = useState<ZoningEntry[]>([{ type: 'AK', buildingRight: 0 }]);

    useEffect(() => {
        if (isOpen) {
            setFormData({
                name: '',
                createdBy: username || '',
                buyer: '',
                pricePerRight: '',
                soldDate: new Date().toISOString().split('T')[0],
                desc: ''
            });
            setZonings([{ type: 'AK', buildingRight: 0 }]);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const totalBuildingRight = zonings.reduce((sum, z) => sum + (z.buildingRight || 0), 0);
    // Automatically calculate final price based on total building right and price per right
    const finalPrice = totalBuildingRight * (parseInt(formData.pricePerRight) || 0);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const plotData: any = {
            ...formData,
            status: 'Mennyt',
            zonings: JSON.stringify(zonings),
            buildingRight: totalBuildingRight,
            finalPrice: finalPrice,
            pricePerRight: parseInt(formData.pricePerRight) || 0,
            area: 0,
            address: '',
            kunta: 'Helsinki', // Defaulting to somewhere, can be edited later
            seller: '',
            lat: location?.lat,
            lng: location?.lng
        };

        onSave(plotData, 'add');
        onClose();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
            <div className="bg-white p-6 rounded-lg shadow-xl w-[450px] max-w-full max-h-[90vh] overflow-y-auto relative">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
                    aria-label={t('Sulje')}
                >
                    ×
                </button>

                <h2 className="text-xl font-bold mb-4 pr-8">{t('Lisää mennyt tontti')}</h2>

                <div className="mb-4 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                    {location ? (
                        <span>Sijainti: {location.lat.toFixed(5)}, {location.lng.toFixed(5)}</span>
                    ) : (
                        <span>{t('Sijaintia ei määritetty')}</span>
                    )}
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">{t('Kirjaajan nimi *')}</label>
                        <input name="createdBy" type="text" required value={formData.createdBy} onChange={handleChange}
                            className="w-full border rounded p-2 text-sm" placeholder={t('Oma nimesi')} autoFocus />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">{t('Tontin nimi *')}</label>
                        <input name="name" type="text" required value={formData.name} onChange={handleChange}
                            className="w-full border rounded p-2 text-sm" placeholder={t('Esim. Tontti B')} />
                    </div>

                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-semibold text-gray-700 uppercase">{t('Kaavatyypit & kem *')}</label>
                            <button type="button" onClick={addZoning} className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100">
                                {t('+ Lisää tyyppi')}
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
                                            <option key={z.code} value={z.code}>{z.code}</option>
                                        ))}
                                    </select>
                                    <input
                                        type="number"
                                        required
                                        value={zoning.buildingRight || ''}
                                        onChange={(e) => updateZoning(index, 'buildingRight', e.target.value)}
                                        className="w-24 border rounded p-1.5 text-sm text-right"
                                        placeholder="0 k-m²"
                                    />
                                    {zonings.length > 1 && (
                                        <button type="button" onClick={() => removeZoning(index)} className="text-red-500 hover:text-red-700 p-1">✕</button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">{t('Kem kauppahinta *')}</label>
                            <div className="relative">
                                <input name="pricePerRight" type="number" required value={formData.pricePerRight} onChange={handleChange}
                                    className="w-full border rounded p-2 text-sm pr-12" placeholder="0" />
                                <span className="absolute right-3 top-2 text-xs text-gray-500">€/k-m²</span>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">{t('Laskettu kokoshinta')}</label>
                            <div className="w-full border rounded p-2 text-sm bg-gray-100 text-gray-600">
                                {finalPrice.toLocaleString()} €
                            </div>
                        </div>

                        <div className="col-span-2">
                            <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">{t('Ostaja *')}</label>
                            <input name="buyer" type="text" required value={formData.buyer} onChange={handleChange}
                                className="w-full border rounded p-2 text-sm" placeholder={t('Ostajan nimi / Yritys')} />
                        </div>

                        <div className="col-span-2">
                            <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">{t('Kauppapäivä *')}</label>
                            <input name="soldDate" type="date" required value={formData.soldDate} onChange={handleChange}
                                className="w-full border rounded p-2 text-sm" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">{t('Lisätiedot')}</label>
                        <textarea name="desc" rows={2} value={formData.desc} onChange={handleChange}
                            className="w-full border rounded p-2 text-sm" placeholder={t('Valinnainen kuvaus...')} />
                    </div>

                    <div className="flex justify-end space-x-3 pt-4 border-t">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50">
                            {t('Peruuta')}
                        </button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700">
                            {t('Lisää tontti')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
