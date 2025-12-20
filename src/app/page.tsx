'use client';

import { useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';

export default function Home() {
  const { data: session } = useSession();
  const [url, setUrl] = useState('');
  const [searchDepth, setSearchDepth] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string>('');
  const [searchCandidates, setSearchCandidates] = useState<any[]>([]);
  const [searchDecision, setSearchDecision] = useState<any>(null);

  const processContent = async (content: string, isRawText = false) => {
    setLoading(true);
    setLoadingText('Verbinde...');
    setError('');
    setResult(null);
    setSelectedImage(null);
    setSelectedTitle('');
    setSearchCandidates([]);
    setSearchDecision(null);

    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            url: content, 
            depth: searchDepth,
            isRawText // Neuer Flag für die API
        }),
      });

      if (!response.body) throw new Error('Keine Antwort vom Server');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
                const msg = JSON.parse(line);
                
                if (msg.type === 'status') {
                    setLoadingText(msg.message);
                } else if (msg.type === 'search_candidates') {
                    setSearchCandidates(msg.candidates);
                } else if (msg.type === 'search_decision') {
                    setSearchDecision(msg.decision);
                } else if (msg.type === 'result') {
                    const scanData = msg.data;
                    setResult(scanData);

                    // Auto-Select Logic
                    if (scanData.best_image_url) {
                        setSelectedImage(scanData.best_image_url);
                    } else if (scanData.allImages && scanData.allImages.length > 0) {
                        setSelectedImage(scanData.allImages[0]);
                    }

                    // Default title logic
                    if (scanData.title_suggestions && scanData.title_suggestions.short) {
                        setSelectedTitle(scanData.title_suggestions.short);
                    } else {
                        setSelectedTitle(scanData.title || "Unbekannter Titel");
                    }
                } else if (msg.type === 'error') {
                    throw new Error(msg.message);
                }
            } catch (jsonError) {
                console.error('Stream Error:', jsonError);
            }
        }
      }

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = (e: React.FormEvent) => {
    e.preventDefault();
    processContent(url);
  };

  const handleGmailScan = async () => {
    setLoading(true);
    setLoadingText('📧 Durchsuche Gmail nach Rechnungen...');
    try {
        const res = await fetch('/api/gmail/latest');
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Fehler beim Gmail-Abruf');
        
        if (!data.found) {
            setError('Keine passenden Mails gefunden.');
            setLoading(false);
            return;
        }

        setLoadingText(`📄 Mail gefunden: "${data.email.subject}". Analysiere...`);
        // Wir senden den Body der Mail direkt an den AI Scanner
        await processContent(data.email.body, true);
        
    } catch (err: any) {
        setError(err.message);
        setLoading(false);
    }
  };

  const googleCandidates = searchCandidates.filter(c => c.source === 'Google Official');
  const serperCandidates = searchCandidates.filter(c => c.source === 'Serper (Google)');

  // Hilfsfunktion um Preis sicher anzuzeigen
  const renderPrice = (price: any) => {
    if (!price) return '?';
    if (typeof price === 'object') {
        return price.amount || price.value || JSON.stringify(price);
    }
    return price;
  };

  // Hilfsfunktion um Währung sicher anzuzeigen
  const renderCurrency = (result: any) => {
    if (typeof result.price === 'object' && result.price?.currency) return result.price.currency;
    return result.currency || 'EUR';
  };

  return (
    <main className="min-h-screen p-8 max-w-5xl mx-auto font-sans bg-gray-50 text-gray-900">
      
      {/* Header mit Auth */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-blue-900">
            Digital Inventory Twin <span className="text-blue-500">AI</span>
        </h1>
        
        <div className="flex items-center gap-4">
            {session ? (
                <div className="flex items-center gap-3 bg-white p-2 pr-4 rounded-full shadow-sm border border-gray-200">
                    {/*eslint-disable-next-line @next/next/no-img-element*/ }
                    <img src={session.user?.image || ''} alt="User" className="w-8 h-8 rounded-full" />
                    <span className="text-xs font-bold text-gray-600 hidden sm:inline">{session.user?.name}</span>
                    <button onClick={() => signOut()} className="text-xs text-red-500 hover:underline font-bold">Logout</button>
                </div>
            ) : (
                <button 
                    onClick={() => signIn('google')}
                    className="bg-white text-gray-700 px-4 py-2 rounded-xl border border-gray-300 flex items-center gap-2 hover:bg-gray-50 transition-all font-bold text-sm shadow-sm"
                >
                    {/* Google Icon SVG */}
                    <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.27.81-.57z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/><path fill="none" d="M1 1 23 23"/></svg>
                    Gmail Connect
                </button>
            )}
        </div>
      </div>

      <div className="bg-white p-8 rounded-2xl shadow-xl border border-blue-100">
        <h2 className="text-xl font-semibold mb-6 text-gray-800">Smart Scanner & Search</h2>
        
        <form onSubmit={handleImport} className="flex flex-col gap-4">
          <div className="flex gap-3">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Link ODER Produktname eingeben (z.B. 'iPhone 17 Pro')"
                required
                className="flex-1 p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none bg-gray-50 text-black"
              />
              
              {session && (
                  <button
                    type="button"
                    onClick={handleGmailScan}
                    disabled={loading}
                    className="bg-indigo-100 text-indigo-700 py-4 px-6 rounded-xl hover:bg-indigo-200 disabled:opacity-50 font-bold transition-all border border-indigo-200 shadow-sm active:scale-95 flex items-center gap-2"
                  >
                    📧 Gmail Scan
                  </button>
              )}

              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 text-white py-4 px-8 rounded-xl hover:bg-blue-700 disabled:opacity-50 font-bold transition-all shadow-md active:scale-95 whitespace-nowrap min-w-[160px]"
              >
                {loading ? (
                    <span className="flex items-center gap-2">
                        <span className="animate-spin text-xl">↻</span> Scanning...
                    </span>
                ) : '✨ Scan / Search'}
              </button>
          </div>
          
          {/* Depth Slider / Mode Selector */}
          <div className="flex items-center gap-4 px-2">
            <span className="text-sm font-bold text-gray-500 uppercase tracking-widest">Suchtiefe:</span>
            <div className="flex items-center gap-4 flex-1">
                <input 
                    type="range" 
                    min="1" 
                    max="3" 
                    step="1"
                    value={searchDepth}
                    onChange={(e) => setSearchDepth(parseInt(e.target.value))}
                    className="w-48 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <span className={`text-sm font-bold px-3 py-1 rounded-full border ${searchDepth === 1 ? 'bg-green-100 text-green-700 border-green-200' : 'bg-purple-100 text-purple-700 border-purple-200'}`}>
                    {searchDepth === 1 ? '⚡ Schnell (1)' : searchDepth === 2 ? '⚖️ Balance (2)' : '⚔️ Tournament (3)'}
                </span>
                <span className="text-xs text-gray-400">
                    {searchDepth === 1 ? 'Nimmt das erste Ergebnis.' : 'Vergleicht Top ' + searchDepth + ' Seiten parallel.'}
                </span>
            </div>
          </div>
        </form>

        {loading && (
            <div className="mt-6 p-6 bg-blue-50 text-blue-800 rounded-xl border border-blue-200 text-center animate-pulse transition-all duration-300">
                <p className="font-bold text-lg mb-4">{loadingText}</p>
                <div className="h-1 w-32 bg-blue-200 mx-auto rounded-full overflow-hidden mb-6">
                    <div className="h-full bg-blue-500 animate-progress origin-left"></div>
                </div>

                {/* SEARCH BATTLE DISPLAY */}
                {searchCandidates.length > 0 && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                            {/* Google Spalte */}
                            <div className="bg-white/60 p-4 rounded-lg border border-blue-100">
                                <h3 className="text-xs font-bold uppercase text-red-500 mb-2 flex items-center gap-2">
                                    🔍 Google Official <span className="bg-red-100 text-red-600 px-1 rounded">{googleCandidates.length}</span>
                                </h3>
                                <ul className="space-y-2">
                                    {googleCandidates.slice(0, 3).map((c, i) => (
                                        <li key={i} className="text-sm">
                                            <div className="font-semibold text-gray-800 truncate">{c.title}</div>
                                            <div className="text-xs text-gray-400 truncate">{new URL(c.link).hostname}</div>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {/* Serper Spalte */}
                            <div className="bg-white/60 p-4 rounded-lg border border-blue-100">
                                <h3 className="text-xs font-bold uppercase text-green-600 mb-2 flex items-center gap-2">
                                    🌐 Serper API <span className="bg-green-100 text-green-700 px-1 rounded">{serperCandidates.length}</span>
                                </h3>
                                <ul className="space-y-2">
                                    {serperCandidates.slice(0, 3).map((c, i) => (
                                        <li key={i} className="text-sm">
                                            <div className="font-semibold text-gray-800 truncate">{c.title}</div>
                                            <div className="text-xs text-gray-400 truncate">{new URL(c.link).hostname}</div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        {/* AI REASONING DISPLAY */}
                        {searchDecision && (
                            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200 text-left animate-fade-in">
                                <h3 className="text-sm font-bold uppercase text-indigo-600 mb-2">🧠 AI Entscheidung</h3>
                                <p className="text-indigo-900 italic text-lg leading-relaxed">"{searchDecision.reasoning}"</p>
                                <div className="mt-2 text-xs text-indigo-400 font-mono break-all">
                                    Gewählter Link: {searchDecision.selected_url || "Mehrere Kandidaten"}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        )}

        {error && (
          <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 flex items-center gap-2">
             <span className="font-bold">⚠️</span> {error}
          </div>
        )}
      </div>

      {result && (
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
          
          {/* Details Column */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* AI Summary Card */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-6 rounded-2xl border border-blue-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded uppercase">AI Summary</span>
                    <span className="text-blue-800 font-bold">{renderPrice(result.price)} {renderCurrency(result)}</span>
                </div>
                <p className="text-blue-900 italic text-lg leading-relaxed">"{result.summary || 'Keine Zusammenfassung verfügbar.'}"</p>
                
                {/* Quelle anzeigen */}
                {result.originalUrl && (
                    <a href={result.originalUrl} target="_blank" className="text-xs text-blue-400 hover:text-blue-600 mt-2 block truncate">
                        🔗 Quelle: {result.originalUrl}
                    </a>
                )}

                <div className="mt-4 flex gap-2">
                    <span className="px-3 py-1 bg-white rounded-full text-sm font-medium text-gray-600 border border-gray-200">
                        📁 {result.category || 'Allgemein'}
                    </span>
                </div>
            </div>

            {/* Title Selection */}
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Wähle einen Titel</h3>
                <div className="space-y-3">
                    {result.title_suggestions ? (
                        Object.entries(result.title_suggestions).map(([key, value]: any) => (
                            <div 
                                key={key}
                                onClick={() => setSelectedTitle(String(value))}
                                className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedTitle === String(value) ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-300'}`}
                            >
                                <div className="text-xs text-gray-400 uppercase font-bold mb-1">{key}</div>
                                <div className="font-medium text-gray-900">{String(value)}</div>
                            </div>
                        ))
                    ) : (
                        <div className="p-4 bg-gray-50 rounded-xl text-gray-500 italic text-center">
                            Keine Titel-Vorschläge gefunden.
                        </div>
                    )}
                </div>
            </div>

            {/* Image Gallery */}
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Alle Bilder</h3>
                <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                    {result.allImages && result.allImages.length > 0 ? (
                        result.allImages.map((img: string, idx: number) => (
                            <button 
                                key={idx}
                                onClick={() => setSelectedImage(img)}
                                className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${selectedImage === img ? 'border-blue-500 ring-2 ring-blue-200 scale-105' : 'border-transparent hover:border-gray-300'}`}
                            >
                                {/*eslint-disable-next-line @next/next/no-img-element*/ }
                                <img src={img} alt={`Gefunden ${idx}`} className="object-cover w-full h-full" />
                            </button>
                        ))
                    ) : (
                        <div className="col-span-full p-8 text-center text-gray-400 bg-gray-50 rounded-lg">
                            Keine Bilder gefunden.
                        </div>
                    )}
                </div>
            </div>
          </div>

          {/* Final Preview Column */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200 sticky top-8">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 text-center">Dein neues Item</h3>
                
                <div className="aspect-square rounded-xl overflow-hidden bg-gray-50 border border-gray-100 mb-6 relative group">
                    {selectedImage ? (
                        /*eslint-disable-next-line @next/next/no-img-element*/ 
                        <img src={selectedImage} alt="Vorschau" className="object-contain w-full h-full p-2" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">Kein Bild</div>
                    )}
                </div>

                <div className="mb-6">
                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">Gewählter Titel</label>
                    <p className="font-bold text-gray-900 leading-snug">{selectedTitle}</p>
                </div>

                <div className="flex justify-between items-center mb-6 pt-4 border-t border-gray-100">
                    <div>
                        <label className="text-xs font-bold text-gray-400 uppercase block">Preis</label>
                        <p className="font-mono text-lg">{renderPrice(result.price)} {renderCurrency(result)}</p>
                    </div>
                    <div className="text-right">
                        <label className="text-xs font-bold text-gray-400 uppercase block">Kategorie</label>
                        <p className="text-sm font-medium bg-gray-100 px-2 py-1 rounded">{result.category || 'Sonstiges'}</p>
                    </div>
                </div>

                <button 
                    className="w-full bg-green-600 text-white py-4 rounded-xl font-bold hover:bg-green-700 shadow-lg transition-all active:scale-95 flex justify-center items-center gap-2"
                    onClick={() => alert('Speichern-Funktion kommt als nächstes!')}
                >
                    <span>💾 Speichern</span>
                </button>
            </div>
          </div>

        </div>
      )}

      {/* AI Debug Log Section (Full Width) */}
      {result && result.aiLog && (
        <div className="w-full max-w-[98vw] mt-20 mb-20 animate-fade-in">
            <details className="group bg-gray-950 rounded-xl overflow-hidden border border-gray-800 shadow-2xl open:pb-6">
                <summary className="p-6 font-mono text-sm text-gray-300 cursor-pointer hover:bg-gray-900 flex items-center justify-between transition-colors">
                    <span className="flex items-center gap-3">
                        <span className="text-green-500 text-xl">➜</span> 
                        <span className="font-bold text-lg">AI Developer Console</span> 
                        <span className="text-gray-500 text-xs uppercase tracking-wider border border-gray-700 px-2 py-1 rounded">
                            Mode: {searchDepth > 1 ? `Tournament (${searchDepth} Scouts)` : 'Single Shot'}
                        </span>
                    </span>
                    <span className="group-open:rotate-180 transition-transform duration-300 text-gray-500">▼</span>
                </summary>
                
                <div className="px-6 pt-4 overflow-x-auto">
                    <div className="flex flex-col xl:flex-row gap-6 min-w-full">
                        
                        {/* --- PHASE 1: MANAGER (Search) --- */}
                        {result.aiLog.search && (
                            <LogColumn 
                                title="Phase 1: Search Manager" 
                                color="blue"
                                log={result.aiLog.search} 
                            />
                        )}

                        {/* --- PHASE 2: SCOUTS (Parallel) --- */}
                        {result.aiLog.scouts && result.aiLog.scouts.length > 0 && (
                            <div className="flex-1 flex flex-col gap-4 min-w-[400px]">
                                <div className="p-3 bg-purple-900/20 border border-purple-500/30 rounded-lg text-center">
                                    <h3 className="text-sm font-bold text-purple-400 uppercase tracking-widest">
                                        Phase 2: The Scouts ({result.aiLog.scouts.length})
                                    </h3>
                                </div>
                                <div className="flex gap-4 overflow-x-auto pb-4 snap-x">
                                    {result.aiLog.scouts.map((scout: any, idx: number) => (
                                        <div key={idx} className="min-w-[350px] snap-center">
                                            <LogColumn 
                                                title={`Scout #${idx + 1} (${new URL(result.aiLog.search.output?.top_candidates?.[idx] || "http://unknown").hostname})`}
                                                color="purple"
                                                log={scout}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* --- PHASE 3: JURY (Judge) --- */}
                        {result.aiLog.jury && (
                            <LogColumn 
                                title="Phase 3: The Jury" 
                                color="red"
                                log={result.aiLog.jury} 
                            />
                        )}

                        {/* --- FALLBACK SCAN (If single mode or Raw Text) --- */}
                        {result.aiLog.scan && !result.aiLog.scouts && (
                             <LogColumn 
                                title="Direct AI Extraction" 
                                color="orange"
                                log={result.aiLog.scan} 
                            />
                        )}
                        
                    </div>
                </div>
            </details>
        </div>
      )}

    </main>
  );
}

// --- SUB-COMPONENTS FOR LOGGING ---

function LogColumn({ title, color, log }: { title: string, color: string, log: any }) {
    const colors: any = {
        blue: { border: 'border-blue-900', text: 'text-blue-400', bg: 'bg-blue-900/10', glow: 'shadow-blue-500/20' },
        purple: { border: 'border-purple-900', text: 'text-purple-400', bg: 'bg-purple-900/10', glow: 'shadow-purple-500/20' },
        red: { border: 'border-red-900', text: 'text-red-400', bg: 'bg-red-900/10', glow: 'shadow-red-500/20' },
        orange: { border: 'border-orange-900', text: 'text-orange-400', bg: 'bg-orange-900/10', glow: 'shadow-orange-500/20' },
    };
    const c = colors[color] || colors.blue;

    return (
        <div className={`flex-1 bg-gray-900 rounded-xl border border-gray-800 overflow-hidden flex flex-col min-w-[350px] shadow-lg ${c.glow}`}>
            {/* Header */}
            <div className={`p-4 border-b border-gray-800 bg-gray-950/50 flex items-center gap-2 sticky top-0 z-10`}>
                <div className={`w-3 h-3 rounded-full ${c.bg.replace('/10', '')} shadow-[0_0_8px_currentColor] ${c.text}`}></div>
                <h3 className={`text-xs font-bold ${c.text} uppercase tracking-wider`}>{title}</h3>
            </div>

            {/* Content Scroll */}
            <div className="p-4 space-y-6 font-mono text-xs overflow-y-auto max-h-[800px] scrollbar-thin scrollbar-thumb-gray-700">
                
                {/* 1. TEMPLATE */}
                <LogBlock label="🟦 SYSTEM (Prompt Template)" content={log.template} collapsed={true} />

                {/* 2. USER INPUT */}
                <LogBlock label="🟧 USER (Input Data)" content={log.input} collapsed={true} />

                {/* 3. FULL PROMPT */}
                <LogBlock label="🟪 FULL CONTEXT (Sent to LLM)" content={log.full_prompt} collapsed={true} />

                {/* 4. OUTPUT */}
                <div className="space-y-2">
                    <div className="text-green-500 font-bold flex justify-between items-center">
                        <span>🟩 ASSISTANT (Raw Output)</span>
                        <span className="text-[10px] bg-green-900/20 px-2 rounded text-green-300">JSON</span>
                    </div>
                    <div className="bg-black/80 p-3 rounded border border-green-900/30 text-green-400 whitespace-pre-wrap font-mono text-[11px] leading-relaxed shadow-inner">
                        {typeof log.output === 'string' ? log.output : JSON.stringify(log.output, null, 2)}
                    </div>
                </div>

            </div>
        </div>
    );
}

function LogBlock({ label, content, collapsed = false }: { label: string, content: string, collapsed?: boolean }) {
    return (
        <details className="group space-y-2" open={!collapsed}>
            <summary className="text-gray-500 font-bold cursor-pointer hover:text-gray-300 flex justify-between items-center select-none">
                <span>{label}</span>
                <span className="text-[10px] group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="bg-gray-950 p-3 rounded border border-gray-800 text-gray-400 whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto text-[10px] shadow-inner">
                {content}
            </div>
        </details>
    );
}