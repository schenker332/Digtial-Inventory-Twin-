import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client"; // Direkt importieren
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  // Lokale Instanz für diesen Request (Fix für Hot-Reload Issues)
  const prisma = new PrismaClient();
  
  try {
    const { families, model = "gpt-4o-mini", preview = false, reset = false } = await request.json();

    if (reset) {
        console.log("🧹 Clearing previous clusters (Reset requested)...");
        // 1. Items entkoppeln
        await prisma.item.updateMany({
            data: { clusterId: null, originalFamily: null }
        });
        // 2. Cluster löschen
        await prisma.cluster.deleteMany();
        console.log("✅ Database clean.");
    }

    if (!families || !Array.isArray(families) || families.length === 0) {
      return NextResponse.json({ error: "No families provided" }, { status: 400 });
    }

    // 1. Datenaufbereitung für das LLM
    const inputList = families.map((f, index) => ({
        id: index, // Temporäre ID für das Mapping
        familyName: f.familyName
    }));

    // 2. Bestehende Cluster laden
    const existingClusters = await prisma.cluster.findMany({
        select: { name: true }
    });
    const existingNames = existingClusters.map(c => c.name).join(", ");

    const systemPrompt = `
    Du bist ein Inventar-Manager. Deine Aufgabe ist es, redundante Produkt-Gruppen ("Familien") zu konsolidieren.
    
    INPUT:
    Eine Liste von Familien. Jede hat eine ID und einen Hauptnamen (familyName).
    
    AUFGABE:
    1. Analysiere die Liste. Finde Einträge, die dasselbe physische Produkt beschreiben.
    2. Wenn Einträge zusammengehören, fasse sie unter einem neuen, sauberen "Canonical Name" zusammen.
    3. Der "Canonical Name" soll präzise sein (Marke + Modell + Typ), z.B. "Shimano ST-R7120 Griffgummi".
    
    WICHTIGE REGELN FÜR MERGES:
    - **Generisch vs. Spezifisch:** Wenn ein Eintrag "Kettenpeitsche" heißt und ein anderer "ParkTool Kettenpeitsche SR-12.2", dann GEHÖREN SIE ZUSAMMEN! Ordne den generischen Begriff dem spezifischen Cluster zu.
    - **Synonyme & Wortstellung:** "Shimano Disc Rotor" == "Bremsscheibe Shimano". Das ist das Gleiche -> MERGEN.
    - **Varianten:** "T-Shirt Pink M" und "T-Shirt Pink L" -> MERGEN in "T-Shirt Pink" (Größe ist egal für den Cluster).
    - **Sei mutig bei Werkzeug/Teilen:** Niemand kauft 3 verschiedene Kettenprüfer gleichzeitig. Fasse sie zusammen.
    
    EXISTIERENDE PRODUKTE (Nutze diese exakt, wenn es passt):
    [${existingNames.substring(0, 1000)}]...

    OUTPUT FORMAT (JSON):
    {
      "merges": [
        {
          "canonicalName": "Name des Clusters",
          "idsToMerge": [0, 5, 12] 
        },
        ...
      ]
    }
    Jede Input-ID muss genau einmal in 'idsToMerge' auftauchen! Vergiss niemanden.
    `;

    // --- PREVIEW MODE ---
    if (preview) {
        return NextResponse.json({
            preview: true,
            debug: {
                model: model,
                systemPrompt: systemPrompt,
                input: inputList
            }
        });
    }

    console.log(`🤖 Starting AI-Merge using ${model} for ${families.length} families...`);

    // OpenAI Aufruf
    const completion = await openai.chat.completions.create({
        model: model, // Dynamisches Modell
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(inputList) }
        ],
        response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0].message.content || "{}");
    const merges = result.merges || [];

    // --- LOG ÜBERSCHREIBEN (Radikal: Löschen & Neu) ---
    try {
        await prisma.processLog.deleteMany(); // Tabelle leeren
        await prisma.processLog.create({
            data: {
                id: 'LATEST_RUN',
                model: model,
                batchSize: inputList.length,
                systemPrompt: systemPrompt,
                inputJson: JSON.stringify(inputList),
                outputJson: JSON.stringify(result)
            }
        });
        console.log("✅ Log saved successfully.");
    } catch (logError) {
        console.error("⚠️ Failed to save ProcessLog:", logError);
    } 

    console.log(`✅ AI schlägt ${merges.length} Cluster vor.`);

    // 3. Datenbank Updates durchführen
    const logs: string[] = [];
    const createdItemsDebug: any[] = [];

    for (const mergeGroup of merges) {
        const { canonicalName, idsToMerge } = mergeGroup;
        
        // Cluster erstellen oder finden
        // Wir nutzen upsert, falls der Name exakt schon existiert
        let clusterId;
        
        try {
            // Check if exists manually to avoid unique constraint race condition slightly
            const existing = await prisma.cluster.findUnique({ where: { name: canonicalName } });
            if (existing) {
                clusterId = existing.id;
            } else {
                const newCluster = await prisma.cluster.create({
                    data: { name: canonicalName }
                });
                clusterId = newCluster.id;
            }
        } catch (e) {
            // Fallback: Wenn Name belegt/Konflikt, hängen wir Random String an (Dirty Fix, aber sicher)
            const safeName = `${canonicalName} (${Date.now().toString().slice(-4)})`;
            const newCluster = await prisma.cluster.create({
                data: { name: safeName }
            });
            clusterId = newCluster.id;
        }

        const itemIdsToUpdate: string[] = [];
        const itemDetails: any[] = [];
        const mergedFamilyNames: string[] = [];

        // Alle Items der betroffenen Familien sammeln
        idsToMerge.forEach((famId: number) => {
            const family = families[famId];
            if (family) {
                mergedFamilyNames.push(family.familyName);
                family.subgroups.forEach((sg: any) => {
                    sg.items.forEach((item: any) => {
                        itemIdsToUpdate.push(item.id);
                        itemDetails.push({
                            id: item.id,
                            name: item.name,
                            price: item.price,
                            currency: item.currency,
                            shop: item.shop,
                            buyDate: item.buyDate,
                            mailId: item.analysisCacheId
                        });
                    });
                });
            }
        });

        // Batch Update der Items pro Familie einzeln, um originalFamily korrekt zu setzen
        for (const famId of idsToMerge) {
            const family = families[famId];
            if (!family) continue;

            const familyItemIds: string[] = [];
            family.subgroups.forEach((sg: any) => {
                sg.items.forEach((item: any) => {
                    familyItemIds.push(item.id);
                });
            });

            if (familyItemIds.length > 0) {
                 await prisma.item.updateMany({
                    where: { id: { in: familyItemIds } },
                    data: { 
                        clusterId: clusterId,
                        originalFamily: family.familyName // NEU: Speichern der Herkunft
                    }
                });
            }
        }

        /* VERALTET: Alter Massen-Update Block entfernt */
        
        logs.push(`Cluster "${canonicalName}": ${itemIdsToUpdate.length} Items zugeordnet.`);
            
            createdItemsDebug.push({
                clusterName: canonicalName,
                mergedFamilies: mergedFamilyNames, // NEU: Liste der Ursprungs-Familien
                items: itemDetails
            });
    }

    const debugObj = {
        model: model,
        systemPrompt: systemPrompt,
        input: inputList,
        output: result
    };
    
    console.log("DEBUG RESPONSE PREP:", { 
        hasPrompt: !!systemPrompt, 
        hasInput: !!inputList, 
        hasOutput: !!result,
        outputKeys: Object.keys(result || {})
    });

    return NextResponse.json({
        success: true,
        logs: logs,
        createdItems: createdItemsDebug,
        debug: debugObj
    });

  } catch (error: any) {
    console.error("Super-Merge Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}