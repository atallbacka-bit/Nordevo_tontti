"use client";
import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PlotData, MarkOfferedData } from '@/types';

interface MarkOfferedModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (offerData: MarkOfferedData) => void;
    plot: PlotData | null;
}

export default function MarkOfferedModal({
    isOpen,
    onClose,
    onSave,
    plot
}: MarkOfferedModalProps) {
    const { username } = useAuth();
    const [formData, setFormData] = useState({
        offerPrice: '',
        offerDate: new Date().toISOString().split('T')[0],
        desc: '',
        updatedBy: ''
    });

    useEffect(() => {
        if (isOpen) {
            setFormData({
                offerPrice: '',
                offerDate: new Date().toISOString().split('T')[0],
                desc: '',
                updatedBy: username || ''
            });
        }
    }, [isOpen]);

    if (!isOpen || !plot) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            ...formData,
            offerPrice: parseInt(formData.offerPrice) || 0
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

                <h2 className="text-xl font-bold mb-4 pr-8">Merkitse tarjotuksi</h2>

                <div className="mb-4 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                    <p className="font-semibold">{plot.name}</p>
                    <p>{plot.address}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="bg-blue-50 p-3 rounded border border-blue-100">
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
                        <label className="block text-xs font-semibold text-gray-700 uppercase">Tarjoushinta (€) *</label>
                        <input
                            name="offerPrice"
                            type="number"
                            required
                            value={formData.offerPrice}
                            onChange={handleChange}
                            className="w-full border rounded p-2 text-sm"
                            placeholder="0"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase">Tarjouspäivä *</label>
                        <input
                            name="offerDate"
                            type="date"
                            required
                            value={formData.offerDate}
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
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                        >
                            Merkitse tarjotuksi
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
