import { NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      // Body empty is fine
    }
    
    const batchSize = (body as any).batchSize || 10;

    // 1. Fetch unclustered items
    const unclusteredItems = await prisma.item.findMany({
      where: { clusterId: null },
      take: batchSize,
    });

    if (unclusteredItems.length === 0) {
      return NextResponse.json({ message: "No unclustered items found.", operations: [] });
    }

    // 2. Fetch existing clusters
    const existingClusters = await prisma.cluster.findMany({
      select: { id: true, name: true, category: true }
    });

    // 3. Prepare Prompt
    const itemsInput = unclusteredItems.map(i => ({
      id: i.id,
      name: i.name,
      price: i.price,
      shop: i.shop
    }));

    const clustersInput = existingClusters.map(c => ({
      id: c.id,
      name: c.name,
      category: c.category
    }));

    const systemPrompt = `
    Du bist ein präziser Inventar-Manager.
    Deine Aufgabe: Ordne neue Items bestehenden Produkt-Clustern zu ODER erstelle neue Cluster.

    REGELN:
    1.  **Strict Matching**: Wenn ein Item KLARE Ähnlichkeit zu einem bestehenden Cluster hat (z.B. "iPhone 15" zu "Apple iPhone 15"), ordne es zu.
    2.  **Naming**: Wenn du ein neues Cluster erstellst, wähle einen sauberen, kanonischen Produktnamen (ohne "Schwarz", "128GB", "Neu", etc., es sei denn es ist relevant für das Produkt-Modell).
        Beispiel: "Sony WH-1000XM5B" -> Cluster: "Sony WH-1000XM5".
    3.  **Grouping**: Wenn mehrere Items im aktuellen Batch zum selben NEUEN Produkt gehören, erstelle EINEN neuen Cluster und ordne alle darauf zu.

    INPUT DATA:
    - Existing Clusters: Liste bekannter Produkte.
    - New Items: Liste zu verarbeitender Items.

    OUTPUT FORMAT (JSON):
    {
      "operations": [
        { 
          "itemId": "uuid-des-items", 
          "action": "MATCH", 
          "clusterId": "uuid-des-existierenden-clusters",
          "reason": "Warum matched das?"
        },
        { 
          "itemId": "uuid-des-items", 
          "action": "CREATE", 
          "newClusterName": "Kanonischer Name",
          "category": "Kategorie (Electronics, Clothing, etc.)",
          "reason": "Warum neu?"
        }
      ]
    }
    `;

    const userPrompt = JSON.stringify({
      existing_clusters: clustersInput,
      new_items: itemsInput
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 4o-mini ist gut und günstig
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0].message.content || "{}");
    const operations = result.operations || [];

    // 4. Execute Operations
    const log = [];

    // Wir müssen aufpassen bei "CREATE": Wenn das LLM mehrmals denselben neuen Namen vorschlägt, 
    // dürfen wir das Cluster nur EINMAL erstellen.
    const newClusterMap = new Map<string, string>(); // Name -> Real DB ID

    for (const op of operations) {
      try {
        if (op.action === "MATCH" && op.clusterId) {
          await prisma.item.update({
            where: { id: op.itemId },
            data: { clusterId: op.clusterId }
          });
          log.push(`Matched Item ${op.itemId} to Cluster ${op.clusterId}`);
        } 
        else if (op.action === "CREATE" && op.newClusterName) {
          let clusterId = newClusterMap.get(op.newClusterName);

          // Check if we already created it in this batch OR if it existed but LLM missed it (safety check)
          if (!clusterId) {
             // Safety: Check DB again by name to avoid unique constraint error
             const existing = await prisma.cluster.findUnique({ where: { name: op.newClusterName } });
             if (existing) {
                clusterId = existing.id;
             } else {
                const newCluster = await prisma.cluster.create({
                  data: {
                    name: op.newClusterName,
                    category: op.category || "Uncategorized"
                  }
                });
                clusterId = newCluster.id;
             }
             newClusterMap.set(op.newClusterName, clusterId);
          }

          await prisma.item.update({
            where: { id: op.itemId },
            data: { clusterId: clusterId }
          });
          log.push(`Created/Used Cluster '${op.newClusterName}' (${clusterId}) for Item ${op.itemId}`);
        }
      } catch (err: any) {
        log.push(`Error processing item ${op.itemId}: ${err.message}`);
      }
    }

    return NextResponse.json({
      processed: operations.length,
      logs: log,
      raw_operations: operations
    });

  } catch (error: any) {
    console.error("Clustering Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}