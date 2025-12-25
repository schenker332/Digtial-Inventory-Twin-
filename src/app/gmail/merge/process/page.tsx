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
    const [selectedModel, setSelectedModel] = useState("gpt-4o-mini"); // Default Model
    const [previewData, setPreviewData] = useState<any>(null); // Live Preview

    // Wir nutzen Refs für State, der im Loop aktuell sein muss
    const familiesRef = useRef<any[]>([]);

    // Side Panel State für E-Mails
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [emailContent, setEmailContent] = useState<any>(null);
    const [loadingEmail, setLoadingEmail] = useState(false);

    // NEU: Funktion in den Component Scope verschoben
    async function loadExistingInventory() {
        try {
            const res = await fetch("/api/inventory/summary");
            const data = await res.json();
            if (data.summary) {
                // Wir nutzen hier setLiveInventory NICHT, wenn wir mitten im Prozess sind, 
                // weil wir das unten manuell machen (um das "Springen" zu verhindern).
                // Aber wir aktualisieren UNCLUSTERED.
                setUnclustered(data.unclustered || []);
                
                // Optional: Wenn wir nicht processing sind, laden wir auch das Inventar neu (für Full Sync)
                if (!isProcessing) {
                    setLiveInventory(data.summary);
                }
            } 
        } catch (e) {
            console.error("Failed to load inventory summary", e);
        }
    }

    // FETCH PREVIEW (Live Prompt)
    async function fetchPreview(families: any[], model: string) {
        if (families.length === 0) return;
        try {
            const res = await fetch("/api/gmail/process-batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    families: families.slice(0, 50), // Preview für den ersten Batch
                    model: model,
                    preview: true 
                })
            });
            const data = await res.json();
            if (data.preview) {
                setPreviewData(data.debug);
            }
        } catch (e) {
            console.error("Preview failed", e);
        }
    }

    useEffect(() => {
        // Initiale Daten laden (mit Standard Threshold 0.6)
        async function load() {
            setLoading(true);
            const res = await fetch("/api/gmail/items?threshold=0.6");
            const data = await res.json();
            setAllFamilies(data.families || []);
            familiesRef.current = data.families || [];
            
            // Sofort Preview laden
            fetchPreview(data.families || [], selectedModel);
            
            setLoading(false);
        }

        load();
        loadExistingInventory(); // Aufruf der Component-Scope Funktion

        // NEU: Letzte Logs laden
        async function loadLogs() {
            try {
                const res = await fetch("/api/gmail/logs");
                const data = await res.json();
                if (data.log) {
                    const restoredLog: ProcessLog = {
                        batchId: 0, // Markierung für geladene Logs
                        inputNames: data.log.input.map((f: any) => f.familyName),
                        status: 'done',
                        logs: ["Zuletzt gespeicherter Durchlauf"],
                        debug: {
                            model: data.log.model,
                            systemPrompt: data.log.systemPrompt,
                            input: data.log.input,
                            output: data.log.output
                        }
                    } as any;
                    setProcessLogs([restoredLog]);
                }
            } catch (e) {
                console.error("Failed to load logs", e);
            }
        }
        loadLogs();
    }, []);

    // Update Preview wenn Modell sich ändert
    useEffect(() => {
        if (allFamilies.length > 0) {
            fetchPreview(allFamilies, selectedModel);
        }
    }, [selectedModel]);

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
        setLiveInventory([]); // Reset Table (oder behalten?) -> Besser Reset für neuen Run
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
                    body: JSON.stringify({ 
                        families: batch,
                        model: selectedModel,
                        reset: currentBatchId === 1 // RESET BEIM ERSTEN BATCH
                    })
                });
                const data = await res.json();
                console.log("API Response:", data); // DEBUGGING

                if (!res.ok) {
                    throw new Error(data.error || "Server Error");
                }

                // Log Update mit Debug Daten
                setProcessLogs(prev => prev.map(l => 
                    l.batchId === logEntry.batchId 
                    ? { 
                        ...l, 
                        status: 'done', 
                        logs: data.logs || [],
                        debug: data.debug // Jetzt inklusive systemPrompt und model
                      } 
                    : l
                ));

                // Live Inventory Update
                if (data.createdItems) {
                    setLiveInventory(prev => [...data.createdItems, ...prev]);
                }

                // SYNC: Restposten Liste aktualisieren
                loadExistingInventory(); 

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

    const [selectedProduct, setSelectedProduct] = useState<any>(null); // Für die Sidebar

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

                <div className="flex flex-col gap-3 relative z-10 w-72">
                    <div className="bg-gray-100 p-1 rounded-xl flex gap-1 mb-2">
                        <button 
                            onClick={() => setSelectedModel("gpt-4o-mini")}
                            className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${selectedModel === 'gpt-4o-mini' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            gpt-4o-mini
                        </button>
                        <button 
                            onClick={() => setSelectedModel("gpt-5-mini")}
                            className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${selectedModel === 'gpt-5-mini' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            gpt-5-mini
                        </button>
                    </div>
                </div>
            </div>

            {/* 1. ALWAYS VISIBLE PREVIEW BLOCK */}
            {previewData && (
                <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50/50 p-6">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-800 text-xs font-black uppercase px-3 py-1 rounded-full shadow-sm">Current Config</span>
                            <span className="text-sm font-bold text-gray-500">Das wird gesendet:</span>
                        </div>
                        <div className="text-xs font-mono text-gray-400">Model: {selectedModel}</div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">System Prompt</p>
                            <div className="bg-white rounded-xl p-4 text-[10px] font-mono text-gray-500 overflow-y-auto max-h-40 border border-gray-200 shadow-sm">
                                <pre className="whitespace-pre-wrap">{previewData.systemPrompt}</pre>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Input Data</p>
                            <div className="bg-white rounded-xl p-4 text-[10px] font-mono text-gray-500 overflow-y-auto max-h-40 border border-gray-200 shadow-sm">
                                <pre>{JSON.stringify(previewData.input, null, 2)}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 2. ACTIONS */}
            <div className="flex justify-center py-4">
                 {!isProcessing ? (
                        <button 
                            onClick={startProcessing}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-12 rounded-xl shadow-lg shadow-blue-200 transition-all transform hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-2 group w-full max-w-md"
                        >
                            <span>🚀 ANALYSE STARTEN</span>
                        </button>
                    ) : (
                         <div className="bg-gray-900 text-white font-bold py-4 px-12 rounded-xl shadow-inner flex items-center justify-center gap-3 w-full max-w-md">
                            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                            <span>Verarbeite...</span>
                        </div>
                    )}
            </div>

            {/* 3. LAST RUN OUTPUT (FROM DB OR LIVE) */}
            <div className="space-y-8">
                {processLogs.length > 0 ? processLogs.map(log => (
                    <div key={log.batchId} className={`rounded-2xl border-2 overflow-hidden transition-all ${
                        log.status === 'loading' ? 'border-blue-400 bg-blue-50 animate-pulse' :
                        log.status === 'done' ? 'border-gray-200 bg-white shadow-lg' :
                        'border-red-100 bg-red-50'
                    }`}>
                        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <span className="text-sm font-black uppercase tracking-widest text-gray-400">LAST OUTPUT</span>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-green-50 text-green-600 border-green-100">
                                    Status: {log.status}
                                </span>
                            </div>
                        </div>
                        
                        <div className="p-6 space-y-6">
                             <div className="space-y-2">
                                <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-widest">
                                    AI Output (Raw Response)
                                </div>
                                <div className="bg-black rounded-xl p-4 text-[10px] font-mono text-green-400 border border-gray-800 overflow-x-auto max-h-96">
                                    <pre>{(log as any).debug?.output ? JSON.stringify((log as any).debug.output, null, 2) : "Warte auf Antwort..."}</pre>
                                </div>
                             </div>
                        </div>
                    </div>
                )) : (
                    <div className="text-center p-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl">
                        Noch kein Output vorhanden. Starte die Analyse!
                    </div>
                )}
            </div>

            {/* UNCLUSTERED ITEMS WARNING */}

            {/* UNCLUSTERED ITEMS WARNING / INFO */}
            {unclustered.length > 0 && (
                <div className={`rounded-2xl shadow-sm border overflow-hidden mb-8 ${liveInventory.length === 0 ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                    <div className={`p-6 border-b flex justify-between items-center ${liveInventory.length === 0 ? 'border-blue-100' : 'border-red-100'}`}>
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${liveInventory.length === 0 ? 'bg-blue-100 text-blue-600' : 'bg-red-100 text-red-600'}`}>
                                {liveInventory.length === 0 ? 'ℹ️' : '⚠️'}
                            </div>
                            <div>
                                <h2 className={`font-bold text-lg ${liveInventory.length === 0 ? 'text-blue-800' : 'text-red-800'}`}>
                                    {liveInventory.length === 0 ? 'Warteschlange (Rohdaten)' : 'Nicht zugeordnete Items (Restposten)'}
                                </h2>
                                <p className={`text-xs uppercase tracking-widest font-bold ${liveInventory.length === 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                    {liveInventory.length === 0 ? 'Bereit für Clustering' : 'Wurden vom AI-Prozess nicht erfasst'}
                                </p>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                            <span className={`text-sm font-black px-4 py-1 rounded-full ${liveInventory.length === 0 ? 'bg-blue-200 text-blue-800' : 'bg-red-200 text-red-800'}`}>
                                {unclustered.length} Items
                            </span>
                            {liveInventory.length > 0 && (
                                <button 
                                    onClick={processLeftovers}
                                    disabled={loading}
                                    className="bg-white border border-red-300 text-red-700 hover:bg-red-100 px-4 py-2 rounded-lg text-xs font-bold uppercase shadow-sm transition-all"
                                >
                                    {loading ? '⏳...' : '♻️ Restposten zuordnen'}
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="p-0">
                        <table className="w-full text-left text-xs text-gray-600">
                             <thead className={`uppercase font-bold border-b ${liveInventory.length === 0 ? 'bg-blue-50/50 text-blue-400 border-blue-100' : 'bg-red-50/50 text-red-400 border-red-100'}`}>
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
                            onOpenEmail={fetchEmail} // Funktion durchreichen
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
                                                        e.stopPropagation(); // Verhindert dass Accordion zuklappt
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
