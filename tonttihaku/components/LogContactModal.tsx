"use client";
import React, { useState, useEffect } from 'react';
import { useT } from '@/lib/i18n';

interface ContactPerson {
    id: string;
    name: string;
}

interface LogContactModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (log: { date: string; desc: string; agent: string; person: string; personId?: string }) => void;
    contactPersons?: ContactPerson[];
    currentAgent?: string;
    onManageContacts?: () => void;
    preselectedPersonId?: string;
}

export default function LogContactModal({ isOpen, onClose, onSave, contactPersons = [], currentAgent = '', onManageContacts, preselectedPersonId }: LogContactModalProps) {
    const t = useT();
    const [formData, setFormData] = useState({
        date: new Date().toISOString().split('T')[0],
        desc: '',
        agent: currentAgent,
        personId: '',
    });

    useEffect(() => {
        if (isOpen) {
            setFormData({
                date: new Date().toISOString().split('T')[0],
                desc: '',
                agent: currentAgent,
                personId: preselectedPersonId || (contactPersons.length === 1 ? contactPersons[0].id : ''),
            });
        }
    }, [isOpen, contactPersons, currentAgent, preselectedPersonId]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // Determine person name
        let finalPersonName = '';
        if (formData.personId) {
            const selected = contactPersons.find(p => p.id === formData.personId);
            if (selected) finalPersonName = selected.name;
        }

        onSave({
            date: formData.date,
            desc: formData.desc,
            agent: formData.agent,
            person: finalPersonName,
            personId: formData.personId
        });

        onClose();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1002] p-4"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
        >
            <div className="bg-white p-6 rounded-lg shadow-xl w-[450px] max-w-full relative">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
                    aria-label={t('Sulje')}
                >
                    ×
                </button>

                <h2 className="text-lg font-bold mb-4">{t('Uusi kontaktointi')}</h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">{t('Päivämäärä *')}</label>
                        <input
                            name="date"
                            type="date"
                            required
                            value={formData.date}
                            onChange={handleChange}
                            className="w-full border rounded p-2 text-sm"
                        />
                    </div>

                    {/* Contact Person Selection (Strict) */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-xs font-semibold text-gray-700 uppercase">{t('Kenen kanssa? *')}</label>
                            {onManageContacts && (
                                <button
                                    type="button"
                                    onClick={onManageContacts}
                                    className="text-xs text-blue-600 hover:underline ml-3"
                                >
                                    {t('+ Lisää uusi')}
                                </button>
                            )}
                        </div>

                        {contactPersons.length > 0 ? (
                            <select
                                name="personId"
                                value={formData.personId}
                                onChange={handleChange}
                                className="w-full border rounded p-2 text-sm bg-white"
                                required
                            >
                                <option value="" disabled>{t('Valitse henkilö...')}</option>
                                {contactPersons.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        ) : (
                            <div className="text-sm text-gray-500 italic p-2 border rounded bg-gray-50">
                                {t('Ei yhteyshenkilöitä. Lisää uusi aloittaaksesi.')}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">{t('Kommentti *')}</label>
                        <textarea
                            name="desc"
                            required
                            rows={3}
                            value={formData.desc}
                            onChange={handleChange}
                            className="w-full border rounded p-2 text-sm"
                            placeholder={t('Mitä sovittiin / tapahtui...')}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">{t('Kontaktoija (Sinun nimesi) *')}</label>
                        <input
                            name="agent"
                            type="text"
                            required
                            value={formData.agent}
                            onChange={handleChange}
                            className="w-full border rounded p-2 text-sm"
                            placeholder={t('Nimi')}
                        />
                    </div>

                    <div className="flex justify-end space-x-3 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50">{t('Peruuta')}</button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700">{t('Tallenna')}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
