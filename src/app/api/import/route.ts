

import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer';
import OpenAI from 'openai';
import { SEARCH_PROMPT, SCAN_PROMPT, JUDGE_PROMPT } from './prompts';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- HELPER FUNCTIONS ---

async function searchSerper(query: string) {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return [];
    try {
        const response = await fetch("https://google.serper.dev/search", {
            method: 'POST',
            headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ "q": query + " kaufen", "gl": "de", "hl": "de" })
        });
        const data = await response.json();
        return (data.organic || []).map((r: any) => ({
            title: r.title,
            link: r.link,
            snippet: r.snippet,
            source: 'Serper (Google)'
        }));
    } catch (e) {
        console.error("Serper Fehler:", e);
        return [];
    }
}

async function searchGoogle(query: string) {
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;
    if (!apiKey || !cx) return [];
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query + " kaufen")}`;
        const response = await fetch(url);
        const data = await response.json();
        return (data.items || []).map((r: any) => ({
            title: r.title,
            link: r.link,
            snippet: r.snippet,
            source: 'Google Official'
        }));
    } catch (e) {
        console.error("Google API Fehler:", e);
        return [];
    }
}

function cleanHtmlContent(html: string): string {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const trashSelectors = ['script', 'style', 'nav', 'footer', 'iframe', 'noscript', 'svg', '[role="alert"]', '.cookie-banner', '.popup', '#ad'];
    trashSelectors.forEach(s => doc.querySelectorAll(s).forEach(el => el.remove()));
    return (doc.body.textContent || "").replace(/\s+/g, ' ').trim().substring(0, 20000); // Increased limit for better context
}

async function fetchWithPuppeteer(url: string) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return await page.content();
  } catch (e) {
      console.error(`Puppeteer Failed for ${url}:`, e);
      return "";
  } finally {
    await browser.close();
  }
}

async function scrapeUrl(url: string, sendStatus?: (msg: string) => void) {
    let html = '';
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
    } catch (e) {
        if (sendStatus) sendStatus(`🛡️ Nutze Puppeteer für ${new URL(url).hostname}...`);
        html = await fetchWithPuppeteer(url);
    }
    
    if (!html || html.length < 500) return null;

    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const images: string[] = [];
    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (ogImage?.startsWith('http')) images.push(ogImage);
    doc.querySelectorAll('img').forEach((img: any) => {
        const src = img.getAttribute('src');
        if (src?.startsWith('http') && !images.includes(src) && !src.includes('icon')) images.push(src);
    });

    const cleanText = cleanHtmlContent(html);
    return { url, cleanText, images };
}

// --- MAIN HANDLER ---

export async function POST(request: Request) {
  const { url: input, depth = 1, isRawText = false } = await request.json();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));

      // Data Structures for Logs
      let searchLog: any = null;
      let scoutLogs: any[] = [];
      let juryLog: any = null;
      let directScanLog: any = null;

      try {
        if (!input) throw new Error('Eingabe fehlt');

        // --- SPECIAL CASE: RAW TEXT (e.g. Email) ---
        if (isRawText) {
            send({ type: 'status', message: '📄 Analysiere Text-Inhalt (Gmail)...' });
            
            const systemPrompt = SCAN_PROMPT;
            const userContent = `SOURCE: RAW_TEXT\nCONTENT: ${input}`;
            
            const completion = await openai.chat.completions.create({
                model: "gpt-5-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ],
                response_format: { type: "json_object" }
            });
            
            const result = JSON.parse(completion.choices[0].message.content || "{}");
            
            directScanLog = {
                template: SCAN_PROMPT,
                input: `Raw Text (${input.length} chars)`,
                full_prompt: `${systemPrompt}\n\nUSER:\n${userContent}`,
                output: result
            };

            send({
                type: 'result',
                data: {
                    ...result,
                    originalUrl: "Gmail / Raw Text",
                    allImages: [],
                    aiLog: {
                        scan: directScanLog
                    }
                }
            });
            return;
        }

        const isUrl = input.startsWith('http');
        
        // --- PHASE 1: SEARCH MANAGER ---
        let candidates: string[] = [];
        if (isUrl) {
            candidates = [input];
        } else {
            send({ type: 'status', message: `🔍 Suche nach: "${input}"...` });
            const [serperResults, googleResults] = await Promise.all([searchSerper(input), searchGoogle(input)]);
            const allSearchResults = [...serperResults, ...googleResults];
            
            if (allSearchResults.length === 0) throw new Error("Keine Ergebnisse gefunden.");
            send({ type: 'search_candidates', candidates: allSearchResults });

            // Run Search Prompt
            send({ type: 'status', message: `🧠 AI wählt Top ${depth} Kandidaten...` });
            
            const systemPrompt = SEARCH_PROMPT.replace('{depth}', depth.toString());
            const userContent = JSON.stringify(allSearchResults.slice(0, 15)); // Raw Input
            
            const completion = await openai.chat.completions.create({
                model: "gpt-5-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Candidates:\n${userContent}` }
                ],
                response_format: { type: "json_object" }
            });

            const decision = JSON.parse(completion.choices[0].message.content || "{}");
            candidates = decision.top_candidates || [];
            
            searchLog = {
                template: SEARCH_PROMPT,
                input: userContent,
                full_prompt: `${systemPrompt}\n\nUSER:\nCandidates:\n${userContent}`,
                output: decision
            };
            
            send({ type: 'search_decision', decision });
            if (candidates.length === 0) throw new Error("AI hat keine Links ausgewählt.");
        }

        // --- PHASE 2: THE SCOUTS (Parallel Extraction) ---
        send({ type: 'status', message: `⚔️ Entsende ${candidates.length} Scouts...` });

        const scoutPromises = candidates.map(async (url, index) => {
            const scoutId = `Scout #${index + 1}`;
            
            // 1. Scrape
            const scraped = await scrapeUrl(url, (msg) => send({ type: 'status', message: msg }));
            if (!scraped) return null;

            // 2. Scan (Extract Data)
            const systemPrompt = SCAN_PROMPT;
            const userContent = `URL: ${url}\nCONTENT: ${scraped.cleanText}\nIMAGES: ${scraped.images.slice(0, 10).join('\n')}`;
            
            const completion = await openai.chat.completions.create({
                model: "gpt-5-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ],
                response_format: { type: "json_object" }
            });
            
            const result = JSON.parse(completion.choices[0].message.content || "{}");
            
            // Add metadata for the Jury
            return {
                ...result,
                _meta: {
                    url: url,
                    images_found: scraped.images.length,
                    content_length: scraped.cleanText.length,
                    all_images: scraped.images // Pass images through
                },
                _log: {
                    id: scoutId,
                    template: SCAN_PROMPT,
                    input: `URL: ${url} (Content length: ${scraped.cleanText.length})`, // Simplified for log display
                    full_prompt: `${systemPrompt}\n\nUSER:\n${userContent}`,
                    output: result
                }
            };
        });

        const scoutResults = (await Promise.all(scoutPromises)).filter(r => r !== null);
        scoutLogs = scoutResults.map(r => r._log);

        if (scoutResults.length === 0) throw new Error("Alle Scouts sind gescheitert (Blockiert/Leer).");

        // --- PHASE 3: THE JURY (Judge) ---
        let finalResult: any = null;

        if (scoutResults.length === 1 || depth === 1) {
            finalResult = scoutResults[0];
            send({ type: 'status', message: `✅ Ergebnis von ${new URL(finalResult._meta.url).hostname} übernommen.` });
        } else {
            send({ type: 'status', message: '⚖️ Die Jury tagt...' });

            const candidatesForJury = scoutResults.map((r, i) => ({
                index: i,
                url: r._meta.url,
                title: r.title_suggestions?.original || "No Title",
                price: r.price,
                currency: r.currency,
                summary: r.summary,
                data_quality: {
                    images: r._meta.images_found,
                    text_len: r._meta.content_length
                }
            }));

            const systemPrompt = JUDGE_PROMPT
                .replace('{count}', scoutResults.length.toString())
                .replace('{query}', input)
                .replace('{candidates_json}', JSON.stringify(candidatesForJury, null, 2));

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: systemPrompt }],
                response_format: { type: "json_object" }
            });

            const decision = JSON.parse(completion.choices[0].message.content || "{}");
            const winnerIndex = decision.winner_index ?? 0;
            
            finalResult = scoutResults[winnerIndex];
            
            juryLog = {
                template: JUDGE_PROMPT,
                input: JSON.stringify(candidatesForJury, null, 2),
                full_prompt: systemPrompt,
                output: decision
            };
            
            send({ type: 'status', message: `🏆 Gewinner: ${new URL(finalResult._meta.url).hostname}` });
        }

        // --- FINAL RESPONSE ---
        send({
            type: 'result',
            data: {
                ...finalResult,
                originalUrl: finalResult._meta.url,
                allImages: finalResult._meta.all_images,
                aiLog: {
                    search: searchLog,
                    scouts: scoutLogs,
                    jury: juryLog
                }
            }
        });

      } catch (error: any) {
        console.error(error);
        send({ type: 'error', message: error.message || "Unknown Error" });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
}
