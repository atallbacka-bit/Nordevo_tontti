"use client";
import React, { useState, useEffect } from 'react';

interface ContactPerson {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    role?: string;
}

interface EditContactInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (contactPersons: ContactPerson[]) => void;
    initialData?: ContactPerson[];
}

export default function EditContactInfoModal({ isOpen, onClose, onSave, initialData }: EditContactInfoModalProps) {
    const [contacts, setContacts] = useState<ContactPerson[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<ContactPerson>({
        id: '',
        name: '',
        phone: '',
        email: '',
        role: ''
    });
    const [showForm, setShowForm] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setContacts(initialData || []);
            resetForm();
        }
    }, [isOpen, initialData]);

    const resetForm = () => {
        setFormData({ id: '', name: '', phone: '', email: '', role: '' });
        setEditingId(null);
        setShowForm(false);
    };

    if (!isOpen) return null;

    const handleSaveContact = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name.trim()) return;

        let updatedContacts;
        if (editingId) {
            updatedContacts = contacts.map(c => c.id === editingId ? { ...formData, id: editingId } : c);
        } else {
            updatedContacts = [...contacts, { ...formData, id: Date.now().toString() }];
        }

        setContacts(updatedContacts);
        onSave(updatedContacts); // Save immediately
        resetForm();
    };

    const handleEdit = (contact: ContactPerson) => {
        setFormData(contact);
        setEditingId(contact.id);
        setShowForm(true);
    };

    const handleDelete = (id: string) => {
        const updatedContacts = contacts.filter(c => c.id !== id);
        setContacts(updatedContacts);
        onSave(updatedContacts); // Save immediately
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1002] p-4"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
        >
            <div className="bg-white p-6 rounded-lg shadow-xl w-[500px] max-w-full relative max-h-[90vh] overflow-y-auto">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
                    aria-label="Sulje"
                >
                    ×
                </button>

                <h2 className="text-lg font-bold mb-4">Muokkaa yhteyshenkilöitä</h2>

                {/* List of Contacts */}
                <div className="space-y-3 mb-4">
                    {contacts.length === 0 && !showForm && (
                        <p className="text-sm text-gray-500 italic">Ei yhteyshenkilöitä.</p>
                    )}

                    {contacts.map(contact => (
                        <div key={contact.id} className="bg-gray-50 p-3 rounded border flex justify-between items-start">
                            <div>
                                <p className="font-semibold text-sm">{contact.name}</p>
                                <div className="text-xs text-gray-600">
                                    {contact.phone && <div>{contact.phone}</div>}
                                    {contact.email && <div>{contact.email}</div>}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleEdit(contact)}
                                    className="text-xs text-blue-600 hover:underline"
                                >
                                    Muokkaa
                                </button>
                                <button
                                    onClick={() => handleDelete(contact.id)}
                                    className="text-xs text-red-600 hover:underline"
                                >
                                    Poista
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {!showForm ? (
                    <button
                        onClick={() => setShowForm(true)}
                        className="w-full py-2 text-sm font-medium text-blue-600 border border-dashed border-blue-300 rounded hover:bg-blue-50 mb-4"
                    >
                        + Lisää uusi yhteyshenkilö
                    </button>
                ) : (
                    <div className="bg-blue-50 p-4 rounded-lg mb-4 border border-blue-100">
                        <h3 className="text-sm font-bold mb-3">{editingId ? 'Muokkaa henkilöä' : 'Uusi yhteyshenkilö'}</h3>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Nimi *</label>
                                <input
                                    name="name"
                                    type="text"
                                    value={formData.name}
                                    onChange={handleChange}
                                    className="w-full border rounded p-2 text-sm"
                                    placeholder="Henkilön nimi"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Puhelin</label>
                                <input
                                    name="phone"
                                    type="text"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    className="w-full border rounded p-2 text-sm"
                                    placeholder="+358..."
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Sähköposti</label>
                                <input
                                    name="email"
                                    type="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    className="w-full border rounded p-2 text-sm"
                                    placeholder="email@example.com"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    onClick={resetForm}
                                    className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded"
                                >
                                    Peruuta
                                </button>
                                <button
                                    onClick={handleSaveContact}
                                    disabled={!formData.name.trim()}
                                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
                                >
                                    {editingId ? 'Päivitä' : 'Lisää'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex justify-end pt-2 border-t mt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                    >
                        Sulje
                    </button>
                </div>
            </div>
        </div>
    );
}
