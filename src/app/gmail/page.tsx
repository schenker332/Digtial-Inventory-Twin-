'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';

export default function GmailInbox() {
  const { data: session } = useSession();
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMail, setSelectedMail] = useState<any>(null);
  
  // Search & Pagination State
  const DEFAULT_FILTER = 'Bestellung OR Rechnung OR Order OR Invoice OR Versand';
  const [searchTerm, setSearchTerm] = useState(DEFAULT_FILTER);
  const [activeSearch, setActiveSearch] = useState(DEFAULT_FILTER);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(50); 
  
  // Analysis State
  const [analysisResults, setAnalysisResults] = useState<Record<string, any>>({});
  const [isMining, setIsMining] = useState(false);
  const [showIrrelevant, setShowIrrelevant] = useState(true); 
  
  // --- DERIVED STATE ---
  const visibleEmails = emails.filter(mail => {
      if (showIrrelevant) return true;
      const analysis = analysisResults[mail.id];
      if (analysis?.status === 'done' && !analysis.data?.is_relevant) {
          return false;
      }
      return true;
  });

  const displayedEmails = visibleEmails.slice(0, pageSize);

  // --- FUNKTIONEN ---

  const fetchEmails = async (pageToken: string | null = null, query: string = '', limit: number = 50) => {
    setLoading(true);
    if (!pageToken) {
        setAnalysisResults({}); 
        setEmails([]); 
        setSelectedMail(null);
    }

    try {
      const params = new URLSearchParams();
      if (pageToken) params.set('pageToken', pageToken);
      if (query) params.set('search', query);
      params.set('limit', limit.toString());
      
      const res = await fetch(`/api/gmail/list?${params.toString()}`);
      const data = await res.json();
      
      if (data.emails) {
        setEmails(prev => pageToken ? [...prev, ...data.emails] : data.emails);
        setNextPageToken(data.nextPageToken || null);

        const existingResults: Record<string, any> = { ...analysisResults };
        data.emails.forEach((mail: any) => {
            if (mail.existingAnalysis) {
                existingResults[mail.id] = mail.existingAnalysis;
            }
        });
        setAnalysisResults(prev => ({...prev, ...existingResults}));
      } else {
        if (!pageToken) setEmails([]);
        setNextPageToken(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const runDeepInspector = async () => {
      if (emails.length === 0) return;
      setIsMining(true);
      
      const batchSize = 5;
      for (let i = 0; i < emails.length; i += batchSize) {
          const batch = emails.slice(i, i + batchSize);
          await Promise.all(batch.map(async (mail) => {
              try {
                  setAnalysisResults(prev => ({ ...prev, [mail.id]: { status: 'loading' } }));
                  const res = await fetch('/api/gmail/analyze', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: mail })
                  });
                  const data = await res.json();
                  setAnalysisResults(prev => ({ ...prev, [mail.id]: { status: 'done', data: data } }));
              } catch (e) {
                  setAnalysisResults(prev => ({ ...prev, [mail.id]: { status: 'error' } }));
              }
          }));
      }
      setIsMining(false);
  };

  // --- EFFECTS & HANDLERS ---

  useEffect(() => {
    if (session) fetchEmails(null, DEFAULT_FILTER, pageSize);
  }, [session]); 

  useEffect(() => {
     if (!loading && nextPageToken && visibleEmails.length < pageSize) {
         fetchEmails(nextPageToken, activeSearch, 50);
     }
  }, [visibleEmails.length, pageSize, nextPageToken, loading, activeSearch]);

  const handleSearchSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      setActiveSearch(searchTerm); 
      fetchEmails(null, searchTerm, pageSize);
  };

  const handleReset = () => {
     setSearchTerm(DEFAULT_FILTER);
     setActiveSearch(DEFAULT_FILTER);
     fetchEmails(null, DEFAULT_FILTER, pageSize); 
  };

  if (!session) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
            <button onClick={() => signIn('google')} className="bg-blue-600 text-white px-6 py-2 rounded-lg">Login</button>
        </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 h-[85vh]">
        
        {/* SIDEBAR */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col border border-gray-200">
            <div className="p-4 border-b border-gray-100 bg-gray-50 space-y-3">
                <div className="flex justify-between items-center">
                    <h2 className="font-bold text-lg text-gray-700">Inbox</h2>
                    <div className="flex gap-2">
                        <button onClick={handleReset} className="p-2 hover:bg-gray-200 rounded-full" title="Reload">🔄</button>
                        <Link href="/" className="p-2 hover:bg-gray-200 rounded-full text-blue-600" title="Home">🏠</Link>
                    </div>
                </div>
                
                <div className="flex flex-col gap-2">
                    <form onSubmit={handleSearchSubmit} className="flex gap-2">
                        <input 
                            type="text" 
                            placeholder="🔍 Suche..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button type="submit" className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-bold">Go</button>
                    </form>

                    <div className="flex items-center gap-2">
                         <div className="flex-1 flex items-center justify-between bg-gray-100 p-2 rounded-lg">
                            <span className="text-xs font-bold text-gray-500">🚫 Irrelevante?</span>
                            <button 
                                onClick={() => setShowIrrelevant(!showIrrelevant)}
                                className={`w-8 h-4 flex items-center rounded-full p-0.5 transition-colors ${showIrrelevant ? 'bg-blue-600' : 'bg-gray-300'}`}
                            >
                                <div className={`bg-white w-3 h-3 rounded-full shadow-md transform transition-transform ${showIrrelevant ? 'translate-x-4' : ''}`}></div>
                            </button>
                        </div>
                        <div className="flex flex-col items-end gap-1 w-1/2">
                            <label htmlFor="pageSizeSlider" className="text-[10px] font-bold text-gray-500">{pageSize} Mails</label>
                            <input 
                                id="pageSizeSlider" type="range" min="10" max="200" step="10" value={pageSize} 
                                onChange={(e) => setPageSize(parseInt(e.target.value))}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            />
                        </div>
                    </div>
                    
                    <button 
                        onClick={runDeepInspector} 
                        disabled={isMining || emails.length === 0}
                        className="w-full bg-indigo-600 text-white py-3 rounded-lg text-xs font-bold uppercase hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {isMining ? '⏳ Analysiere...' : '🔍 Tiefenanalyse Starten'}
                    </button>
                    
                    <Link href="/gmail/merge" className="w-full bg-emerald-600 text-white py-3 rounded-lg text-xs font-bold uppercase hover:bg-emerald-700 text-center block">
                        📦 Inventory Merger Öffnen
                    </Link>
                </div>

                <div className="flex border-b border-gray-200 mt-2">
                    <div className="flex-1 py-2 text-sm font-bold text-blue-600 border-b-2 border-blue-600 text-center">Mails ({emails.length})</div>
                </div>
            </div>
            
            <div className="overflow-y-auto flex-1 p-2 space-y-2">
                {loading && <div className="p-4 text-center text-gray-500">Lade Mails...</div>}
                {displayedEmails.map((mail, idx) => {
                    const analysis = analysisResults[mail.id];
                    const isRelevant = analysis?.data?.is_relevant;
                    const items = analysis?.data?.items || [];

                    return (
                        <div key={`${mail.id}-${idx}`} onClick={() => setSelectedMail(mail)} className={`relative p-4 rounded-xl cursor-pointer border transition-all ${selectedMail?.id === mail.id ? 'bg-blue-50 border-blue-500' : 'bg-white border-gray-100'} ${isRelevant ? 'border-l-4 border-l-green-500' : ''}`}>
                                        <div className="absolute top-2 right-2">
                                            {analysis?.status === 'loading' && <span className="animate-spin text-gray-400 text-xs">⏳</span>}
                                            {analysis?.status === 'done' && (
                                                <div className="group relative">
                                                    <span className="text-lg">{isRelevant ? '✅' : '🚫'}</span>
                                                    <div className="absolute right-0 top-6 w-64 bg-gray-900 text-white text-xs p-3 rounded shadow-xl z-50 hidden group-hover:block pointer-events-none">
                                                        <p className="font-bold border-b border-gray-700 pb-1 mb-1">{isRelevant ? "Gefunden" : "Ignoriert"}</p>
                                                        <p className="italic mb-2">"{analysis.data?.reasoning}"</p>
                                                        {items.map((item: any, i: number) => (
                                                            <div key={i} className="bg-gray-800 p-1 rounded mt-1 text-[10px] font-mono text-green-400">+ {item.name}</div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="font-bold text-xs text-gray-900 truncate pr-8">{mail.from.replace(/<.*>/, '')}</div>
                                        <div className="text-[9px] text-gray-400">{new Date(mail.date).toLocaleDateString()}</div>
                                        <div className="font-medium text-blue-800 text-sm truncate mb-1">{mail.subject}</div>
                                        
                                        {isRelevant && items.length > 0 && (
                                            <div className="mt-2 space-y-1">
                                                {items.map((item: any, i: number) => (
                                                    <div key={i} className="bg-green-50 text-green-800 text-[10px] px-2 py-1 rounded border border-green-200 font-bold flex justify-between">
                                                        <span>📦 {item.name}</span>
                                                        {item.price && <span>{item.price}</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );                })}
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-between items-center text-[10px] font-bold text-gray-500">
                <span>{displayedEmails.length} / {pageSize} Mails angezeigt</span>
                {loading && <span className="text-blue-500 animate-pulse">Lade...</span>}
            </div>
        </div>

        {/* DETAIL VIEW */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col border border-gray-200 h-full">
            {selectedMail ? (
                <div className="flex flex-col h-full">
                    <div className="p-6 border-b border-gray-100 bg-gray-50">
                        <h1 className="text-xl font-bold text-gray-900 mb-2">{selectedMail.subject}</h1>
                        <div className="text-xs text-gray-600 mb-4"><div><span className="font-bold">Von:</span> {selectedMail.from}</div><div><span className="font-bold">Datum:</span> {selectedMail.date}</div></div>
                        
                        {/* RESTORED ANALYSIS DEBUG VIEW */}
                        {analysisResults[selectedMail.id]?.data && (
                            <div className="space-y-2">
                                <div className="bg-indigo-50 p-2 rounded border border-indigo-100">
                                    <details>
                                        <summary className="font-bold text-indigo-800 text-[10px] uppercase cursor-pointer">🤖 Stufe 1 (Gatekeeper)</summary>
                                        <div className="mt-2 text-xs text-indigo-900">
                                            <p className="italic mb-1">"{analysisResults[selectedMail.id].data.gatekeeper?.reason}"</p>
                                            <div className="font-mono bg-gray-800 text-green-400 p-2 rounded text-[9px] overflow-x-auto">
                                                {analysisResults[selectedMail.id].data.debug_input_gatekeeper || "Kein Debug Info"}
                                            </div>
                                        </div>
                                    </details>
                                </div>
                                {analysisResults[selectedMail.id].data.expert && (
                                    <div className="bg-emerald-50 p-2 rounded border border-emerald-100">
                                        <details open>
                                            <summary className="font-bold text-emerald-800 text-[10px] uppercase cursor-pointer">🤖 Stufe 2 (Expert)</summary>
                                            <div className="mt-2 text-xs text-emerald-900">
                                                <p className="italic mb-1">"{analysisResults[selectedMail.id].data.expert.reasoning}"</p>
                                                <div className="font-mono bg-gray-800 text-green-400 p-2 rounded text-[9px] overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                                                    {analysisResults[selectedMail.id].data.debug_input_expert || "Kein Debug Info"}
                                                </div>
                                            </div>
                                        </details>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex-1 bg-white overflow-hidden relative">
                         <iframe srcDoc={selectedMail.body} className="w-full h-full border-none absolute inset-0" title="Email Preview" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts" />
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center"><div className="text-6xl mb-4">📧</div><p>Wähle eine Mail aus.</p></div>
            )}
        </div>
      </div>
    </div>
  );
}