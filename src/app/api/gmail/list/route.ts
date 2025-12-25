import { auth } from "@/auth";
import { google } from "googleapis";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Helper: Rekursive Suche nach Body
const extractBody = (parts: any[]): string => {
  // Helper für Base64Url Decoding (Gmail Standard)
  const decode = (data: string) => {
    // Base64Url zu Base64 konvertieren
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  };

  // Helper für HTML Escaping (Sicherheit für Plain Text)
  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // 1. Suche nach text/html
  let part = parts.find(p => p.mimeType === 'text/html');
  if (part && part.body?.data) {
    return decode(part.body.data); // Rohes HTML zurückgeben
  }

  // 2. Suche nach text/plain
  part = parts.find(p => p.mimeType === 'text/plain');
  if (part && part.body?.data) {
    const rawText = decode(part.body.data);
    // Wrapping für Plain Text: Erhält Newlines und Fonts
    return `<div style="white-space: pre-wrap; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; color: #374151; padding: 16px;">${escapeHtml(rawText)}</div>`;
  }

  // 3. Rekursiv in Sub-Parts suchen
  for (const p of parts) {
    if (p.mimeType?.startsWith('multipart/') && p.parts) {
      const found = extractBody(p.parts);
      if (found) return found;
    }
  }

  return "";
};

export async function GET(request: Request) {
  const session = (await auth()) as any;
  const { searchParams } = new URL(request.url);
  const pageToken = searchParams.get('pageToken') || undefined;
  const searchQuery = searchParams.get('search') || ''; 
  const limit = parseInt(searchParams.get('limit') || '50', 10); // Dynamisches Limit

  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  try {
    const authClient = new google.auth.OAuth2();
    authClient.setCredentials({ access_token: session.accessToken as string });

    const gmail = google.gmail({ version: 'v1', auth: authClient });

    let q = searchQuery || ''; 

    // 1. Suche nach Mails
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: q, 
      maxResults: limit, // Hier nutzen wir das Limit vom Frontend
      pageToken: pageToken
    });

    const messages = response.data.messages;
    if (!messages || messages.length === 0) {
      return NextResponse.json({ emails: [], nextPageToken: null });
    }

    // 2. Details für ALLE gefundenen Mails holen (In Batches um Rate-Limits zu vermeiden)
    // Wir verarbeiten immer 25 Mails gleichzeitig.
    const fetchBatchDetails = async (msgs: any[]) => {
        const results = [];
        const chunkSize = 25; 
        for (let i = 0; i < msgs.length; i += chunkSize) {
            const chunk = msgs.slice(i, i + chunkSize);
            const chunkPromises = chunk.map(async (msg) => {
                try {
                    const details = await gmail.users.messages.get({
                        userId: 'me',
                        id: msg.id!,
                        format: 'full',
                    });

                    const payload = details.data.payload;
                    const headers = payload?.headers;
                    const subject = headers?.find(h => h.name === 'Subject')?.value || 'Kein Betreff';
                    const from = headers?.find(h => h.name === 'From')?.value || 'Unbekannt';
                    const date = headers?.find(h => h.name === 'Date')?.value || '';

                    let body = "";
                    if (payload?.parts) {
                        body = extractBody(payload.parts);
                    } else if (payload?.body?.data) {
                        body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
                    }

                    // --- DATABASE CHECK ---
                    const dbAnalysis = await prisma.analysisCache.findUnique({
                        where: { id: msg.id! }
                    });

                    let cachedAnalysis = null;
                    if (dbAnalysis) {
                        const parsed = JSON.parse(dbAnalysis.resultJson);
                        cachedAnalysis = {
                            status: 'done',
                            data: {
                                ...parsed,
                                is_relevant: dbAnalysis.isRelevant,
                                reasoning: dbAnalysis.reasoning,
                                debug_input_gatekeeper: dbAnalysis.debugInputG,
                                debug_input_expert: dbAnalysis.debugInputE
                            }
                        };
                    }

                    return {
                        id: msg.id,
                        threadId: msg.threadId,
                        subject,
                        from,
                        date,
                        snippet: details.data.snippet,
                        body: body || "(Kein lesbarer Text gefunden)",
                        existingAnalysis: cachedAnalysis 
                    };
                } catch (e) {
                    console.error(`Fehler bei Mail ${msg.id}`, e);
                    return null;
                }
            });
            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
        }
        return results;
    };

    const emailsRaw = await fetchBatchDetails(messages);
    const emails = emailsRaw.filter(e => e !== null);

    return NextResponse.json({ 
        emails, 
        nextPageToken: response.data.nextPageToken || null 
    });

  } catch (error: any) {
    console.error("Gmail List Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}