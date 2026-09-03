"use client";
import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useT } from '@/lib/i18n';

interface NoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (note: { text: string; author: string }) => void;
    plotName?: string;
}

export default function NoteModal({ isOpen, onClose, onSave, plotName }: NoteModalProps) {
    const t = useT();
    const { username } = useAuth();
    const [text, setText] = useState('');
    const [author, setAuthor] = useState('');

    useEffect(() => {
        if (isOpen) {
            setText('');
            setAuthor(username || '');
        }
    }, [isOpen, username]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (text.trim() && author.trim()) {
            onSave({ text: text.trim(), author: author.trim() });
            setText('');
            setAuthor('');
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1001] p-4"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
        >
            <div className="bg-white p-6 rounded-lg shadow-xl w-[400px] max-w-full relative">
                {/* Close button */}
                <button
                    type="button"
                    onClick={() => {
                        setText('');
                        setAuthor('');
                        onClose();
                    }}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
                    aria-label={t('Sulje')}
                >
                    ×
                </button>

                <h2 className="text-lg font-bold mb-2 pr-8">{t('Lisää muistiinpano')}</h2>
                {plotName && (
                    <p className="text-sm text-gray-600 mb-4">Kohde: {plotName}</p>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                            {t('Muistiinpano *')}
                        </label>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            required
                            rows={4}
                            className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder={t('Kirjoita muistiinpano...')}
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                            {t('Nimesi *')}
                        </label>
                        <input
                            type="text"
                            value={author}
                            onChange={(e) => setAuthor(e.target.value)}
                            required
                            className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder={t('Oma nimesi')}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            {t('Aikaleima lisätään automaattisesti.')}
                        </p>
                    </div>

                    <div className="flex justify-end space-x-3 pt-2">
                        <button
                            type="button"
                            onClick={() => {
                                setText('');
                                setAuthor('');
                                onClose();
                            }}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                        >
                            {t('Peruuta')}
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                        >
                            {t('Lisää')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
