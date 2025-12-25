import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST() {
  try {
    // 1. Hole alle "Waisen" (Items ohne Cluster)
    const orphans = await prisma.item.findMany({
      where: { clusterId: null },
      select: { id: true, name: true }
    });

    if (orphans.length === 0) {
      return NextResponse.json({ message: "Keine Restposten vorhanden." });
    }

    // 2. Hole alle existierenden Cluster
    const clusters = await prisma.cluster.findMany({
      select: { id: true, name: true }
    });

    console.log(`♻️ Processing Leftovers: ${orphans.length} Orphans vs ${clusters.length} Clusters`);

    // 3. Prompt Engineering
    const systemPrompt = `
    Du bist ein Inventar-Aufräum-Experte.
    
    SITUATION:
    Wir haben eine Liste von "Unassigned Items" (Waisen) und eine Liste von "Existing Clusters" (Bereits sortierte Produkte).
    
    AUFGABE:
    Ordne die Waisen zu.
    1. **MATCH EXISTING:** Wenn ein Waise zu einem existierenden Cluster gehört, ordne ihn zu (Nutze die Cluster ID).
    2. **NEW GROUP:** Wenn mehrere Waisen zusammengehören (aber kein Cluster existiert), bilde einen NEUEN Cluster.
    3. **SINGLETON:** Wenn ein Waise einzigartig ist und wichtig wirkt, erstelle einen NEUEN Cluster für ihn allein.
    
    INPUT DATEN:
    Existing Clusters: ${JSON.stringify(clusters.map(c => ({ id: c.id, name: c.name })))}
    Unassigned Items: ${JSON.stringify(orphans.map(i => ({ id: i.id, name: i.name })))}

    OUTPUT FORMAT (JSON):
    {
      "assignments": [
        { "itemId": "item-uuid-1", "targetClusterId": "cluster-uuid-A" }, // Zuordnung zu existierendem
        ...
      ],
      "newClusters": [
        { "name": "Neuer Produkt Name", "itemIds": ["item-uuid-2", "item-uuid-3"] }, // Neue Gruppe
        ...
      ]
    }
    `;

    // OpenAI Call
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "user", content: systemPrompt }
        ],
        response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0].message.content || "{}");
    const assignments = result.assignments || [];
    const newClusters = result.newClusters || [];

    const logs: string[] = [];

    // 4. DB Updates: Zuordnungen
    for (const assign of assignments) {
        // Validierung: Existiert Item und Cluster?
        const itemExists = orphans.find(o => o.id === assign.itemId);
        const clusterExists = clusters.find(c => c.id === assign.targetClusterId);
        
        if (itemExists && clusterExists) {
            await prisma.item.update({
                where: { id: assign.itemId },
                data: { 
                    clusterId: assign.targetClusterId,
                    originalFamily: "Late-Assign: " + itemExists.name // Notiz dass es nachträglich kam
                }
            });
            logs.push(`Item '${itemExists.name}' -> Existing Cluster '${clusterExists.name}'`);
        }
    }

    // 5. DB Updates: Neue Cluster
    for (const newC of newClusters) {
        if (newC.itemIds && newC.itemIds.length > 0) {
            // Cluster erstellen
            const cluster = await prisma.cluster.create({
                data: { name: newC.name }
            });

            // Items updaten
            await prisma.item.updateMany({
                where: { id: { in: newC.itemIds } },
                data: { 
                    clusterId: cluster.id,
                    originalFamily: "Late-Group"
                }
            });
            logs.push(`New Cluster '${newC.name}' created with ${newC.itemIds.length} items.`);
        }
    }

    return NextResponse.json({ success: true, logs });

  } catch (error: any) {
    console.error("Leftovers Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
