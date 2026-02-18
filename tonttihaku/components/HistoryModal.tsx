"use client";
import React from 'react';
import { PlotData, ContactLog, Note } from '@/types';

interface HistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    plot: PlotData;
}

export default function HistoryModal({ isOpen, onClose, plot }: HistoryModalProps) {
    if (!isOpen) return null;

    // Parse logs and notes
    let logs: ContactLog[] = [];
    try {
        logs = JSON.parse(plot.contacts || '[]');
    } catch { logs = []; }

    let notes: Note[] = [];
    try {
        notes = JSON.parse(plot.notes || '[]');
    } catch { notes = []; }

    // Combine and sort by date/timestamp desc
    const historyItems = [
        ...logs.map(l => ({ ...l, type: 'contact' })),
        ...notes.map(n => ({ ...n, type: 'note', date: n.timestamp.split('T')[0] })) // Use timestamp date for sorting
    ].sort((a, b) => {
        // Compare dates (descending)
        const dateA = a.type === 'contact' ? (a as ContactLog).date : (a as Note).timestamp;
        const dateB = b.type === 'contact' ? (b as ContactLog).date : (b as Note).timestamp;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1002] p-4"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
        >
            <div className="bg-white p-6 rounded-lg shadow-xl w-[500px] max-w-full max-h-[80vh] flex flex-col relative">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
                    aria-label="Sulje"
                >
                    ×
                </button>

                <h2 className="text-xl font-bold mb-1 pr-8">Historia</h2>
                <p className="text-sm text-gray-600 mb-4">{plot.name}</p>

                <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                    {historyItems.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">Ei historiaa.</p>
                    ) : (
                        historyItems.map((item: any) => (
                            <div
                                key={item.id}
                                className={`p-3 rounded border text-sm ${item.type === 'contact'
                                        ? 'bg-green-50 border-green-200'
                                        : 'bg-white border-gray-200'
                                    }`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <div>
                                        <span className={`font-bold uppercase text-xs ${item.type === 'contact' ? 'text-green-700' : 'text-gray-500'
                                            }`}>
                                            {item.type === 'contact' ? 'Kontaktointi' : 'Muistiinpano'}
                                        </span>
                                        <div className="text-xs text-gray-500">
                                            {new Date(item.type === 'contact' ? item.date : item.timestamp).toLocaleDateString()}
                                            {' • '}
                                            {item.type === 'contact' ? item.agent : item.author}
                                        </div>
                                    </div>
                                </div>
                                <p className="text-gray-800 whitespace-pre-wrap">{item.type === 'contact' ? item.desc : item.text}</p>
                            </div>
                        ))
                    )}
                </div>

                <div className="mt-4 pt-4 border-t text-right">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm text-gray-700">Sulje</button>
                </div>
            </div>
        </div>
    );
}
