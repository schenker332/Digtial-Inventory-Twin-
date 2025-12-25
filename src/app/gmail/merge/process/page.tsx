"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

type ProcessLog = {
    batchId: number;
    inputNames: string[];
    status: 'loading' | 'done' | 'error';
    logs: string[];
};

export default function ProcessPage() {
    const [allFamilies, setAllFamilies] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [processLogs, setProcessLogs] = useState<ProcessLog[]>([]);
    const [liveInventory, setLiveInventory] = useState<any[]>([]); // Neue Tabelle für Ergebnisse
    const [unclustered, setUnclustered] = useState<any[]>([]); // NEU: Waisen

    // Wir nutzen Refs für State, der im Loop aktuell sein muss
    const familiesRef = useRef<any[]>([]);

    // Side Panel State für E-Mails
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [emailContent, setEmailContent] = useState<any>(null);
    const [loadingEmail, setLoadingEmail] = useState(false);

    useEffect(() => {
        // Initiale Daten laden (mit Standard Threshold 0.6)
        async function load() {
            setLoading(true);
            const res = await fetch("/api/gmail/items?threshold=0.6");
            const data = await res.json();
            setAllFamilies(data.families || []);
            familiesRef.current = data.families || [];
            setLoading(false);
        }

        // NEU: Bestehendes Inventar aus der DB laden
        async function loadExistingInventory() {
            try {
                const res = await fetch("/api/inventory/summary");
                const data = await res.json();
                if (data.summary) {
                    setLiveInventory(data.summary);
                }
                if (data.unclustered) {
                    setUnclustered(data.unclustered);
                }
            } catch (e) {
                console.error("Failed to load inventory summary", e);
            }
        }

        load();
        loadExistingInventory();
    }, []);

    // ... (Restlicher Code, aber wir fügen die UI für Unclustered hinzu)

    // Suchen wir die Stelle vor dem "Resultierendes Inventar" Block


    // ESC Key zum Schließen der Sidebar
    useEffect(() => {
        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setSelectedEmailId(null);
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);

    async function fetchEmail(id: string) {
        setLoadingEmail(true);
        setEmailContent(null);
        setSelectedEmailId(id);
        try {
            const res = await fetch(`/api/gmail/message/${id}`);
            const data = await res.json();
            setEmailContent(data);
        } catch (e) {
            console.error("Failed to fetch email", e);
        } finally {
            setLoadingEmail(false);
        }
    }

    const startProcessing = async () => {
        setIsProcessing(true);
        setLiveInventory([]); // Reset Table
        setProcessLogs([]);
        
        let currentBatchId = 1;
        const batchSize = 50; // SUPER-BATCH: Viel Kontext für das LLM
        
        let queue = [...familiesRef.current];
        const total = queue.length;

        while (queue.length > 0) {
            const batch = queue.slice(0, batchSize);
            queue = queue.slice(batchSize); 

            const logEntry: ProcessLog = {
                batchId: currentBatchId,
                inputNames: batch.map(f => f.familyName),
                status: 'loading',
                logs: []
            };
            setProcessLogs(prev => [logEntry, ...prev]);

            try {
                const res = await fetch("/api/gmail/process-batch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ families: batch })
                });
                const data = await res.json();

                // Log Update mit Debug Daten
                setProcessLogs(prev => prev.map(l => 
                    l.batchId === logEntry.batchId 
                    ? { 
                        ...l, 
                        status: 'done', 
                        logs: data.logs || [],
                        debug: data.debug // Raw Input/Output speichern
                      } 
                    : l
                ));

                // Live Inventory Update
                if (data.createdItems) {
                    setLiveInventory(prev => [...data.createdItems, ...prev]);
                }

            } catch (e) {
                setProcessLogs(prev => prev.map(l => 
                    l.batchId === logEntry.batchId 
                    ? { ...l, status: 'error', logs: ["Error processing batch"] } 
                    : l
                ));
            }

            setProgress(((total - queue.length) / total) * 100);
            currentBatchId++;
            await new Promise(r => setTimeout(r, 800));
        }

        setIsProcessing(false);
    };

    const [selectedProduct, setSelectedProduct] = useState<any>(null); // Für die Sidebar

    async function processLeftovers() {
        if (!confirm("Soll die AI versuchen, diese Restposten automatisch zuzuordnen?")) return;
        setLoading(true);
        try {
            const res = await fetch("/api/gmail/process-leftovers", { method: "POST" });
            const data = await res.json();
            console.log(data.logs);
            // Reload Inventory
            const invRes = await fetch("/api/inventory/summary");
            const invData = await invRes.json();
            if (invData.summary) setLiveInventory(invData.summary);
            setUnclustered(invData.unclustered || []);
        } catch (e) {
            alert("Fehler beim Aufräumen.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="p-8 max-w-6xl mx-auto bg-gray-50 min-h-screen font-sans space-y-12 relative">
            
            {/* SIDE PANEL OVERLAY (EMAIL VIEW) */}
            {selectedEmailId && (
                <div className="fixed inset-0 z-[200] flex justify-end">
                    {/* Backdrop */}
                    <div 
                        className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity"
                        onClick={() => setSelectedEmailId(null)}
                    ></div>
                    
                    {/* Panel */}
                    <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                        <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                            <h2 className="font-bold text-gray-700">Original E-Mail</h2>
                            <button 
                                onClick={() => setSelectedEmailId(null)}
                                className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
                            >
                                ✕
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6">
                            {loadingEmail ? (
                                <div className="flex justify-center items-center h-40">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                </div>
                            ) : emailContent ? (
                                <div className="space-y-4">
                                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                                        <h1 className="text-xl font-bold text-gray-900 mb-2">{emailContent.subject}</h1>
                                        <div className="text-sm text-gray-600 space-y-1">
                                            <p><strong>Von:</strong> {emailContent.from}</p>
                                            <p><strong>Datum:</strong> {emailContent.date}</p>
                                        </div>
                                    </div>
                                    <div className="prose prose-sm max-w-none border-t pt-4">
                                        <div dangerouslySetInnerHTML={{ __html: emailContent.body }} />
                                    </div>
                                </div>
                            ) : (
                                <div className="text-red-500 text-center">Fehler beim Laden der E-Mail.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            
            {/* BACKDROP für Sidebar (Legacy Product) */}
            {selectedProduct && <div className="fixed inset-0 bg-black/20 z-[90]" onClick={() => setSelectedProduct(null)}></div>}

            <div className="flex justify-between items-end bg-white p-8 rounded-2xl shadow-xl border border-gray-200 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-50 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none"></div>
                
                <div className="relative z-10">
                    <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">AI Inventory</span> Processor
                    </h1>
                    <p className="text-gray-500 font-medium text-lg max-w-lg">
                        Verwandle rohe E-Mail-Daten in ein sauberes Inventar.
                        <br/>
                        <span className="text-sm bg-gray-100 px-2 py-0.5 rounded text-gray-600 mt-2 inline-block">
                            <b>{allFamilies.length}</b> Familien warten auf Verarbeitung
                        </span>
                    </p>
                </div>

                <div className="flex flex-col gap-3 relative z-10 w-64">
                    {!isProcessing ? (
                        <button 
                            onClick={startProcessing}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg shadow-blue-200 transition-all transform hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-2 group"
                        >
                            <span>🚀 ANALYSE STARTEN</span>
                        </button>
                    ) : (
                         <div className="bg-gray-900 text-white font-bold py-4 px-8 rounded-xl shadow-inner flex items-center justify-center gap-3">
                            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                            <span>Verarbeite {progress.toFixed(0)}%...</span>
                        </div>
                    )}
                    
                    {/* Progress Bar */}
                    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-500 ease-out"
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                </div>
            </div>

            {/* BATCH LOGS GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {processLogs.map(log => (
                    <div key={log.batchId} className={`p-4 rounded-xl border-2 transition-all ${
                        log.status === 'loading' ? 'border-blue-400 bg-blue-50 animate-pulse' :
                        log.status === 'done' ? 'border-green-100 bg-white shadow-sm' :
                        'border-red-100 bg-red-50'
                    }`}>
                        <div className="flex justify-between items-center mb-3">
                            <span className="text-xs font-black uppercase tracking-widest text-gray-400">Batch #{log.batchId}</span>
                            {log.status === 'done' && <span className="text-green-600 font-bold text-xs">✅ FERTIG</span>}
                            {log.status === 'error' && <span className="text-red-600 font-bold text-xs">❌ FEHLER</span>}
                        </div>
                        
                        <div className="space-y-2">
                             {/* Input Preview */}
                             <div className="text-xs text-gray-500 mb-2 border-b border-gray-100 pb-2">
                                <strong>Input ({log.inputNames.length}):</strong> {log.inputNames.slice(0, 3).join(", ")}...
                             </div>

                             {/* Result Logs */}
                             {log.logs.length > 0 ? (
                                 <div className="bg-gray-100 rounded p-2 text-[10px] font-mono text-gray-600 max-h-32 overflow-y-auto">
                                     {log.logs.map((l, i) => <div key={i}>&gt; {l}</div>)}
                                 </div>
                             ) : (
                                <div className="text-[10px] text-gray-400 italic">Keine Details...</div>
                             )}

                             {/* DEBUG TOGGLE */}
                             {log.status === 'done' && (
                                 <details className="mt-4">
                                     <summary className="text-[10px] font-bold text-blue-600 cursor-pointer uppercase tracking-tighter hover:underline">
                                         Raw AI JSON anzeigen
                                     </summary>
                                     <div className="mt-2 text-[9px] font-mono bg-black text-green-400 p-3 rounded-lg overflow-x-auto max-h-60">
                                         <p className="mb-2 text-white border-b border-gray-800 pb-1 font-bold">SENT TO AI:</p>
                                         <pre className="mb-4 text-blue-300">{(log as any).debug?.input ? JSON.stringify((log as any).debug.input, null, 2) : "N/A"}</pre>
                                         <p className="mb-2 text-white border-b border-gray-800 pb-1 font-bold">AI RESPONSE:</p>
                                         <pre>{(log as any).debug?.output ? JSON.stringify((log as any).debug.output, null, 2) : "N/A"}</pre>
                                     </div>
                                 </details>
                             )}
                        </div>
                    </div>
                ))}
            </div>

            {/* UNCLUSTERED ITEMS WARNING */}
            {unclustered.length > 0 && (
                <div className="bg-red-50 rounded-2xl shadow-sm border border-red-200 overflow-hidden mb-8">
                    <div className="p-6 border-b border-red-100 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="bg-red-100 text-red-600 p-2 rounded-lg">⚠️</div>
                            <div>
                                <h2 className="font-bold text-red-800 text-lg">Nicht zugeordnete Items (Restposten)</h2>
                                <p className="text-xs text-red-600 uppercase tracking-widest font-bold">Wurden vom AI-Prozess nicht erfasst</p>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                            <span className="bg-red-200 text-red-800 text-sm font-black px-4 py-1 rounded-full">
                                {unclustered.length} Items
                            </span>
                            <button 
                                onClick={processLeftovers}
                                disabled={loading}
                                className="bg-white border border-red-300 text-red-700 hover:bg-red-100 px-4 py-2 rounded-lg text-xs font-bold uppercase shadow-sm transition-all"
                            >
                                {loading ? '⏳...' : '♻️ Restposten zuordnen'}
                            </button>
                        </div>
                    </div>
                    <div className="p-0">
                        <table className="w-full text-left text-xs text-gray-600">
                             <thead className="bg-red-50/50 uppercase font-bold text-red-400 border-b border-red-100">
                                 <tr>
                                     <th className="px-6 py-3">Item Name</th>
                                     <th className="px-6 py-3">Shop</th>
                                     <th className="px-6 py-3">Preis</th>
                                     <th className="px-6 py-3">Datum</th>
                                     <th className="px-6 py-3">Mail-ID</th>
                                 </tr>
                             </thead>
                             <tbody className="divide-y divide-red-100">
                                 {unclustered.map((item: any, idx: number) => (
                                     <tr key={idx} className="hover:bg-red-100/50">
                                         <td className="px-6 py-3 font-medium text-gray-800">{item.name}</td>
                                         <td className="px-6 py-3">{item.shop || "-"}</td>
                                         <td className="px-6 py-3 font-mono">{item.price ? `${item.price} ${item.currency}` : "-"}</td>
                                         <td className="px-6 py-3">
                                            {item.buyDate && item.buyDate !== "Invalid Date"
                                                ? new Date(item.buyDate).toLocaleDateString() 
                                                : <span className="text-gray-300">-</span>}
                                         </td>
                                         <td className="px-6 py-3">
                                            {item.mailId ? (
                                                <button 
                                                    onClick={() => fetchEmail(item.mailId)}
                                                    className="text-red-600 hover:text-red-800 underline font-mono text-[10px]"
                                                >
                                                    {item.mailId.substring(0, 8)}...
                                                </button>
                                            ) : "-"}
                                         </td>
                                     </tr>
                                 ))}
                             </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* UNTERER BEREICH: LIVE INVENTORY LIST (ACCORDION STYLE) */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center rounded-t-2xl">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-600 text-white p-2 rounded-xl shadow-lg">📦</div>
                        <div>
                            <h2 className="font-bold text-gray-800 text-xl">Resultierendes Inventar</h2>
                            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">Live Updates aus dem Prozess</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="bg-blue-100 text-blue-800 text-sm font-black px-5 py-2 rounded-full border border-blue-200 shadow-sm">
                            {liveInventory.length} CLUSTER ERSTELLT
                        </span>
                    </div>
                </div>
                
                <div className="divide-y divide-gray-100">
                    {liveInventory.map((cluster, i) => (
                        <InventoryClusterCard 
                            key={i} 
                            cluster={cluster} 
                            onOpenEmail={fetchEmail}
                        />
                    ))}
                    
                    {liveInventory.length === 0 && (
                        <div className="p-32 text-center">
                            <div className="text-gray-200 font-black text-8xl mb-4 opacity-20 italic">EMPTY</div>
                            <p className="text-gray-400 font-bold uppercase tracking-widest">Warte auf Prozess-Start...</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Sub-Component für sauberes State-Management pro Card
function InventoryClusterCard({ cluster, onOpenEmail }: { cluster: any, onOpenEmail: (id: string) => void }) {
    const [isOpen, setIsOpen] = useState(false);
    
    return (
        <div className="bg-white transition-all hover:bg-gray-50 group">
            <div 
                className="p-6 cursor-pointer flex items-start justify-between"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                         <span className={`transform transition-transform text-gray-400 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                         <h3 className="font-bold text-lg text-gray-800 group-hover:text-blue-600 transition-colors">
                            {cluster.clusterName}
                         </h3>
                         <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-1 rounded-full">
                            {cluster.items.length} Items
                         </span>
                    </div>
                    
                    {/* Level 2: Merged Families */}
                    <div className="pl-6 text-sm text-gray-500">
                        {cluster.mergedFamilies && cluster.mergedFamilies.map((fam: string, idx: number) => (
                            <span key={idx} className="inline-block bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-xs mr-2 border border-blue-100">
                                {fam}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Level 3: Items Table (Collapsible) */}
            {isOpen && (
                <div className="px-6 pb-6 pl-12 animate-in slide-in-from-top-2 duration-200">
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                        <table className="w-full text-left text-xs text-gray-600">
                             <thead className="bg-gray-50 uppercase font-bold text-gray-400">
                                 <tr>
                                     <th className="px-4 py-2">Item Name</th>
                                     <th className="px-4 py-2">Shop</th>
                                     <th className="px-4 py-2">Preis</th>
                                     <th className="px-4 py-2">Datum</th>
                                     <th className="px-4 py-2">Mail-ID</th>
                                 </tr>
                             </thead>
                             <tbody className="divide-y divide-gray-50">
                                 {cluster.items.map((item: any, idx: number) => (
                                     <tr key={idx} className="hover:bg-blue-50/30">
                                         <td className="px-4 py-2 font-medium text-gray-800">{item.name}</td>
                                         <td className="px-4 py-2">{item.shop || "-"}</td>
                                         <td className="px-4 py-2 font-mono">{item.price ? `${item.price} ${item.currency}` : "-"}</td>
                                         <td className="px-4 py-2">
                                            {item.buyDate && item.buyDate !== "Invalid Date"
                                                ? new Date(item.buyDate).toLocaleDateString() 
                                                : <span className="text-gray-300">-</span>}
                                         </td>
                                         <td className="px-4 py-2">
                                            {item.mailId ? (
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onOpenEmail(item.mailId);
                                                    }}
                                                    className="text-blue-600 hover:text-blue-800 underline font-mono text-[10px]"
                                                >
                                                    {item.mailId.substring(0, 8)}...
                                                </button>
                                            ) : "-"}
                                         </td>
                                     </tr>
                                 ))}
                             </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}