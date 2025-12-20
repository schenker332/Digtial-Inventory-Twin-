
import { auth } from "@/auth";
import { google } from "googleapis";
import { NextResponse } from "next/server";

export async function GET() {
  const session = (await auth()) as any;

  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "Nicht eingeloggt oder kein Google Token" }, { status: 401 });
  }

  try {
    const authClient = new google.auth.OAuth2();
    authClient.setCredentials({ access_token: session.accessToken as string });

    const gmail = google.gmail({ version: 'v1', auth: authClient });

    // 1. Suche nach relevanten Mails
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'subject:(Bestellung OR Rechnung OR Order OR Invoice) -category:promotions',
      maxResults: 5,
    });

    const messages = response.data.messages;
    if (!messages || messages.length === 0) {
      return NextResponse.json({ found: false, message: "Keine Rechnungs-Mails gefunden." });
    }

    // 2. Details der neuesten Mail holen
    const latestMsgId = messages[0].id!;
    const msgDetails = await gmail.users.messages.get({
      userId: 'me',
      id: latestMsgId,
      format: 'full',
    });

    const payload = msgDetails.data.payload;
    const headers = payload?.headers;
    const subject = headers?.find(h => h.name === 'Subject')?.value || 'Kein Betreff';
    const from = headers?.find(h => h.name === 'From')?.value || 'Unbekannt';

    // Helper: Rekursive Suche nach Body
    const extractBody = (parts: any[]): string => {
      // 1. Suche nach text/plain
      let part = parts.find(p => p.mimeType === 'text/plain');
      if (part && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }

      // 2. Suche nach text/html
      part = parts.find(p => p.mimeType === 'text/html');
      if (part && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        return html.replace(/<[^>]*>/g, ' '); 
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

    // 3. Body extrahieren
    let body = "";
    if (payload?.parts) {
      body = extractBody(payload.parts);
    } else if (payload?.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    if (!body) {
        body = "Konnte keinen lesbaren Text in der E-Mail finden.";
    }

    return NextResponse.json({
      found: true,
      email: {
        id: latestMsgId,
        subject,
        from,
        snippet: msgDetails.data.snippet,
        body: body.substring(0, 5000) // Limitieren
      }
    });

  } catch (error: any) {
    console.error("Gmail API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
