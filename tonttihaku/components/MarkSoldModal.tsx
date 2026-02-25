"use client";
import React, { useState, useEffect } from 'react';

interface MarkSoldModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (salesData: any) => void;
    plot: any;
}

export default function MarkSoldModal({
    isOpen,
    onClose,
    onSave,
    plot
}: MarkSoldModalProps) {
    const [formData, setFormData] = useState<{ buyer: string; finalPrice: string; pricePerRight: string; soldDate: string; desc: string; updatedBy: string }>({
        buyer: '',
        finalPrice: '',
        pricePerRight: '',
        soldDate: new Date().toISOString().split('T')[0],
        desc: '',
        updatedBy: ''
    });

    useEffect(() => {
        if (isOpen) {
            setFormData({
                buyer: '',
                finalPrice: '',
                pricePerRight: '',
                soldDate: new Date().toISOString().split('T')[0],
                desc: '',
                updatedBy: ''
            });
        }
    }, [isOpen]);

    if (!isOpen || !plot) return null;

    const totalBuildingRight = plot.buildingRight || 0;
    const computedFinalPrice = totalBuildingRight * (parseInt(formData.pricePerRight) || 0);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            ...formData,
            finalPrice: computedFinalPrice,
            pricePerRight: parseInt(formData.pricePerRight) || 0
        });
        onClose();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
        >
            <div className="bg-white p-6 rounded-lg shadow-xl w-[400px] max-w-full relative">
                {/* Close button */}
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
                    aria-label="Sulje"
                >
                    ×
                </button>

                <h2 className="text-xl font-bold mb-4 pr-8">Merkitse myydyksi</h2>

                <div className="mb-4 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                    <p className="font-semibold">{plot.name}</p>
                    <p>{plot.address}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                        <label className="block text-xs font-semibold text-gray-700 uppercase">Kirjaajan nimi *</label>
                        <input
                            name="updatedBy"
                            type="text"
                            required
                            value={formData.updatedBy}
                            onChange={handleChange}
                            className="w-full border rounded p-2 text-sm"
                            placeholder="Oma nimesi"
                            autoFocus
                        />
                    </div>

                    <div>
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

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Kem kauppahinta *</label>
                            <div className="relative">
                                <input
                                    name="pricePerRight"
                                    type="number"
                                    required
                                    value={formData.pricePerRight}
                                    onChange={handleChange}
                                    className="w-full border rounded p-2 text-sm pr-12"
                                    placeholder="0"
                                />
                                <span className="absolute right-3 top-2 text-xs text-gray-500">€/k-m²</span>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Laskettu kokoshinta</label>
                            <div className="w-full border rounded p-2 text-sm bg-gray-100 text-gray-600 truncate">
                                {computedFinalPrice.toLocaleString('fi-FI')} €
                            </div>
                        </div>
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

                    <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase">Lisätiedot</label>
                        <textarea
                            name="desc"
                            rows={2}
                            value={formData.desc}
                            onChange={handleChange}
                            className="w-full border rounded p-2 text-sm"
                            placeholder="Valinnainen kuvaus..."
                        />
                    </div>

                    <div className="flex justify-end space-x-3 pt-4 border-t">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                        >
                            Peruuta
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded hover:bg-green-700"
                        >
                            Merkitse myydyksi
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
