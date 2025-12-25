import { auth } from "@/auth";
import { google } from "googleapis";
import { NextResponse } from "next/server";

// Helper: Rekursive Suche nach Body (identisch zur List Route)
const extractBody = (parts: any[]): string => {
  const decode = (data: string) => {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  };

  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  let part = parts.find(p => p.mimeType === 'text/html');
  if (part && part.body?.data) {
    return decode(part.body.data);
  }

  part = parts.find(p => p.mimeType === 'text/plain');
  if (part && part.body?.data) {
    const rawText = decode(part.body.data);
    return `<div style="white-space: pre-wrap; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; color: #374151; padding: 16px;">${escapeHtml(rawText)}</div>`;
  }

  for (const p of parts) {
    if (p.mimeType?.startsWith('multipart/') && p.parts) {
      const found = extractBody(p.parts);
      if (found) return found;
    }
  }

  return "";
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth()) as any;
  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const authClient = new google.auth.OAuth2();
    authClient.setCredentials({ access_token: session.accessToken as string });

    const gmail = google.gmail({ version: 'v1', auth: authClient });

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: id,
      format: 'full',
    });

    const payload = response.data.payload;
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

    return NextResponse.json({
      id: response.data.id,
      subject,
      from,
      date,
      body: body || "(Kein lesbarer Text gefunden)",
    });

  } catch (error: any) {
    console.error("Gmail Message Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
