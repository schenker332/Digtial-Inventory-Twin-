
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma"; // Datenbank Import

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ... (cleanHtml Funktion bleibt gleich)
const cleanHtml = (html: string): string => {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Styles entfernen
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Scripts entfernen
    .replace(/<[^>]+>/g, ' ') // Alle Tags durch Leerzeichen ersetzen
    .replace(/\s+/g, ' ') // Mehrfache Leerzeichen reduzieren
    .trim();
};

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || !email.id) {
      return NextResponse.json({ error: "Keine Mail oder ID übergeben" }, { status: 400 });
    }

    // --- 1. DATENBANK CHECK ---
    const cached = await prisma.analysisCache.findUnique({
      where: { id: email.id }
    });

    if (cached) {
      const parsedResult = JSON.parse(cached.resultJson);
      
      // SELF-HEALING: Prüfen, ob Items in der DB fehlen, obwohl Cache sagt "Relevant"
      if (cached.isRelevant && parsedResult.items && parsedResult.items.length > 0) {
          const count = await prisma.item.count({ where: { analysisCacheId: email.id } });
          if (count === 0) {
              console.log(`🔧 Self-Healing: Erstelle fehlende Items für Mail ${email.id} aus Cache.`);
              for (const item of parsedResult.items) {
                await prisma.item.create({
                    data: {
                        name: item.name,
                        price: item.price ? parseFloat(item.price.replace(',', '.')) : null,
                        currency: item.currency || 'EUR',
                        shop: item.shop || 'Unbekannt',
                        buyDate: email.date ? new Date(email.date) : new Date(),
                        analysisCacheId: email.id,
                    }
                });
            }
          }
      }

      return NextResponse.json({
          mailId: email.id,
          is_relevant: cached.isRelevant,
          gatekeeper: parsedResult.gatekeeper, // Falls wir das mit gespeichert haben
          expert: parsedResult.expert,
          reasoning: cached.reasoning,
          items: parsedResult.items || [],
          debug_input_gatekeeper: cached.debugInputG,
          debug_input_expert: cached.debugInputE,
          cached: true // Info für Frontend
      });
    }

    // --- 2. ANALYSE (Falls nicht im Cache) ---
    const textPreviewFull = cleanHtml(email.body || "").substring(0, 3000); 
    const textPreviewShort = textPreviewFull.substring(0, 800);

    const userContentShort = `
    Sender: ${email.from}
    Subject: ${email.subject}
    Content Start: ${textPreviewShort}
    `;

    // --- STUFE 1: DER TÜRSTEHER (GPT-4o-mini) ---
    // Ziel: Billig und schnell Müll aussortieren (Pizza, Newsletter, Digitales)
    
    const gatekeeperPrompt = `
    Du bist ein Spam-Filter für ein Inventar-System.
    Frage: Handelt es sich hier WAHRSCHEINLICH um einen Kauf von PHYSISCHEN GÜTERN (Hardware, Kleidung, Möbel)?
    
    ANTWORTE 'keep: true' BEI:
    - Bestellbestätigungen, Rechnungen für physische Ware.
    - Mobilfunk-Verträgen WENN ein Gerät (Handy, Tablet) dabei ist ("Bundle").
    
    ANTWORTE 'keep: false' BEI:
    - Essen (Lieferando, Wolt)
    - Reinen Dienstleistungen (Tickets, Hotel)
    - Reinen Digital-Verträgen OHNE Hardware (nur SIM, nur Streaming)
    - Werbung, Newsletter, "Warenkorb vergessen"
    
    Output JSON: { "keep": boolean, "reason": "Kurze Begründung" }
    `;

    const gatekeeperCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: gatekeeperPrompt },
        { role: "user", content: userContentShort }
      ],
      response_format: { type: "json_object" }
    });

    const gatekeeperResult = JSON.parse(gatekeeperCompletion.choices[0].message.content || "{}");

    // Wenn Gatekeeper "Nein" sagt, speichern & return
    if (!gatekeeperResult.keep) {
        const resultObj = {
            mailId: email.id,
            is_relevant: false,
            gatekeeper: gatekeeperResult,
            expert: null,
            reasoning: `Gatekeeper: ${gatekeeperResult.reason || "Irrelevant"}`,
            items: [],
            debug_input_gatekeeper: userContentShort,
            debug_input_expert: null
        };

        // DB SAVE (Irrelevant)
        await prisma.analysisCache.create({
            data: {
                id: email.id,
                isRelevant: false,
                reasoning: gatekeeperResult.reason,
                resultJson: JSON.stringify(resultObj),
                debugInputG: userContentShort,
                debugInputE: null
            }
        });

        return NextResponse.json(resultObj);
    }

    // --- STUFE 2: DER EXPERTE (GPT-5-mini) ---
    // Ziel: Präzise Extraktion der Daten
    
    const systemPrompt = `
    Du bist ein Experte für Inventarisierung.
    Deine Aufgabe: Analysiere diese EINE E-Mail und extrahiere langlebige, physische Produkte für eine Inventar-Datenbank.

    DEFINITION "INVENTAR-WÜRDIG":
    - JA: Dinge mit Wiederverkaufswert oder langer Nutzungsdauer.
      -> Elektronik (Handy, Laptop, Kopfhörer)
      -> Möbel, Werkzeug, Haushaltsgeräte
      -> Kleidung, Schuhe, Taschen
      -> Sportgeräte (Fahrrad, Hanteln)
      -> Bücher, Physische Medien
    
    - NEIN (Ignorieren):
      -> Verbrauchsgüter (Essen, Kosmetik, Putzmittel, Batterien, Energy-Gels!)
      -> Dienstleistungen (Versand, Reparatur, Tickets)
      -> Verträge & Digitales (Software, Abos, Versicherungen)
      -> Zubehör unter 5€ (wenn es nicht explizit wertvoll wirkt)

    Output Format (JSON):
    {
      "is_relevant": true, // Oder false
      "reasoning": "Erklärung für den Nutzer (z.B. 'Habe iPhone erkannt' oder 'Nur Verbrauchsgüter gefunden').",
      "items": [
        { 
          "name": "Sony WH-1000XM5", 
          "price": "299.00", 
          "currency": "EUR", 
          "shop": "Amazon",
          "category": "Electronics"
        }
      ]
    }
    
    Analysiere gründlich. Wenn mehrere relevante Produkte enthalten sind, liste alle auf.
    `;

    const userContentFull = `
    Sender: ${email.from}
    Subject: ${email.subject}
    Date: ${email.date}
    Content:
    ${textPreviewFull}
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContentFull }
      ],
      response_format: { type: "json_object" }
    });

    const expertResult = JSON.parse(completion.choices[0].message.content || "{}");
    
    const finalResultObj = { 
        mailId: email.id,
        is_relevant: expertResult.is_relevant,
        gatekeeper: gatekeeperResult,
        expert: expertResult,
        reasoning: expertResult.reasoning,
        items: expertResult.items || [],
        debug_input_gatekeeper: userContentShort, 
        debug_input_expert: userContentFull
    };

    // DB SAVE (Relevant or Expert says no)
    await prisma.analysisCache.upsert({
        where: { id: email.id },
        update: {
            isRelevant: expertResult.is_relevant,
            reasoning: expertResult.reasoning,
            resultJson: JSON.stringify(finalResultObj),
            debugInputG: userContentShort,
            debugInputE: userContentFull
        },
        create: {
            id: email.id,
            isRelevant: expertResult.is_relevant,
            reasoning: expertResult.reasoning,
            resultJson: JSON.stringify(finalResultObj),
            debugInputG: userContentShort,
            debugInputE: userContentFull
        }
    });

    // --- NEU: ITEMS IN DIE 'Item' TABELLE SCHREIBEN ---
    // Erst alte Items dieser Mail löschen (damit wir keine Duplikate bei Re-Run haben)
    await prisma.item.deleteMany({
        where: { analysisCacheId: email.id }
    });

    if (expertResult.is_relevant && expertResult.items && Array.isArray(expertResult.items)) {
        for (const item of expertResult.items) {
            await prisma.item.create({
                data: {
                    name: item.name,
                    price: item.price ? parseFloat(item.price.replace(',', '.')) : null, // Preis parsen
                    currency: item.currency || 'EUR',
                    shop: item.shop || 'Unbekannt',
                    buyDate: email.date ? new Date(email.date) : new Date(),
                    analysisCacheId: email.id,
                    // clusterId bleibt erstmal null
                }
            });
        }
    }

    return NextResponse.json(finalResultObj);

  } catch (error: any) {
    console.error("Analyze API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
