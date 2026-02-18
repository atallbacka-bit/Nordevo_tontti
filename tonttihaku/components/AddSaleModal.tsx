"use client";
import React, { useState, useEffect } from 'react';

interface AddSaleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (sale: any) => void;
    location: { lat: number, lng: number } | null;
}

export default function AddSaleModal({ isOpen, onClose, onSave, location }: AddSaleModalProps) {
    const [formData, setFormData] = useState({
        price: '',
        buildingRight: '',
        address: '',
        buyer: ''
    });

    useEffect(() => {
        if (isOpen) {
            setFormData({ price: '', buildingRight: '', address: '', buyer: '' });
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const price = parseInt(formData.price);
        const buildingRight = parseInt(formData.buildingRight);
        const pricePerRight = price && buildingRight ? Math.round(price / buildingRight) : 0;

        onSave({
            ...formData,
            price,
            buildingRight, // Changed from floorArea
            pricePerRight, // Changed from pricePerKem
            date: new Date().toISOString().split('T')[0],
            ...location
        });
        onClose();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl w-96 max-w-full">
                <h2 className="text-xl font-bold mb-4">Lisää myynyt tontti</h2>
                <div className="mb-4 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                    Sijainti: {location?.lat.toFixed(5)}, {location?.lng.toFixed(5)}
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Ostaja</label>
                        <input
                            type="text"
                            name="buyer"
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                            value={formData.buyer}
                            onChange={handleChange}
                            placeholder="Ostajan nimi"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Hinta (€) *</label>
                        <input
                            type="number"
                            name="price"
                            required
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                            value={formData.price}
                            onChange={handleChange}
                            placeholder="Esim. 500000"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Rakennusoikeus (k-m²) *</label>
                        <input
                            type="number"
                            name="buildingRight"
                            required
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                            value={formData.buildingRight}
                            onChange={handleChange}
                            placeholder="Esim. 100"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Osoite</label>
                        <input
                            type="text"
                            name="address"
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                            value={formData.address}
                            onChange={handleChange}
                            placeholder="Katuosoite"
                        />
                    </div>

                    <div className="flex justify-end space-x-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                            Peruuta
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                        >
                            Tallenna
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
