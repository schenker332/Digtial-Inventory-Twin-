import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Jaccard-Ähnlichkeit zwischen zwei Sets von Wörtern
function calculateSimilarity(name1: string, name2: string): number {
  // Bindestriche und Unterstriche durch Leerzeichen ersetzen, damit "A-B" zu "A B" wird
  const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").replace(/[^a-z0-9\s]/g, "");
  
  const tokens1 = new Set(normalize(name1).split(/\s+/).filter(t => t.length > 2));
  const tokens2 = new Set(normalize(name2).split(/\s+/).filter(t => t.length > 2));

  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

export async function GET(request: Request) {
  try {
    const items = await prisma.item.findMany({
      include: { cluster: true },
      orderBy: { buyDate: 'desc' }
    });

    // 1. Level: Strenge Gruppierung (Exact Match)
    const exactGroups: { name: string, items: any[] }[] = [];
    
    // Map hilft uns, Items schnell zuzuordnen
    const groupedMap = new Map<string, any[]>();

    items.forEach(item => {
      const key = item.name.trim();
      if (!groupedMap.has(key)) groupedMap.set(key, []);
      groupedMap.get(key)!.push(item);
    });

    groupedMap.forEach((groupItems, name) => {
      exactGroups.push({ name, items: groupItems });
    });

    // Threshold aus URL lesen (Standard: 0.6)
    const url = new URL(request.url);
    const thresholdParam = url.searchParams.get("threshold");
    const threshold = thresholdParam ? parseFloat(thresholdParam) : 0.6;

    // 2. Level: Familien bilden mit Ähnlichkeits-Logik (O(n^2) aber okay für < 1000 Gruppen)
    const families: { familyName: string, subgroups: any[] }[] = [];
    const assignedIndices = new Set<number>();

    // Wir sortieren die Gruppen nach Länge (längere Namen sind oft präziser)
    exactGroups.sort((a, b) => b.name.length - a.name.length);

    for (let i = 0; i < exactGroups.length; i++) {
      if (assignedIndices.has(i)) continue;

      const currentGroup = exactGroups[i];
      const family = {
        familyName: currentGroup.name, // Der erste wird Familien-Chef
        subgroups: [currentGroup]
      };
      assignedIndices.add(i);

      // Suche nach passenden "Verwandten" in den restlichen Gruppen
      for (let j = i + 1; j < exactGroups.length; j++) {
        if (assignedIndices.has(j)) continue;

        const otherGroup = exactGroups[j];
        const similarity = calculateSimilarity(currentGroup.name, otherGroup.name);

        if (similarity >= threshold) {
          family.subgroups.push({
            ...otherGroup,
            similarity: Math.round(similarity * 100)
          });
          assignedIndices.add(j);
        }
      }
      
      // Das erste Element (der "Chef") hat 100% Ähnlichkeit zu sich selbst
      family.subgroups[0] = {
        ...family.subgroups[0],
        similarity: 100
      };

      families.push(family);
    }

      // Sortieren: Größte Familien nach oben
    families.sort((a, b) => {
        const countA = a.subgroups.reduce((acc, sg) => acc + sg.items.length, 0);
        const countB = b.subgroups.reduce((acc, sg) => acc + sg.items.length, 0);
        return countB - countA;
    });

    // NEU: 100% Matches innerhalb einer Familie verschmelzen
    families.forEach(family => {
        const mergedSubgroups: any[] = [];
        const processedIndices = new Set<number>();

        // Sortiere Subgroups so, dass der "Familien-Chef" (100% Match) vorne steht
        family.subgroups.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

        for (let i = 0; i < family.subgroups.length; i++) {
            if (processedIndices.has(i)) continue;

            const base = family.subgroups[i];
            const mergedItems = [...base.items];

            for (let j = i + 1; j < family.subgroups.length; j++) {
                if (processedIndices.has(j)) continue;
                
                // Prüfen ob Items quasi identisch sind (Wort-Ebene)
                const candidate = family.subgroups[j];
                const sim = calculateSimilarity(base.name, candidate.name);

                if (sim >= 0.99) { // Faktisch identisch
                    mergedItems.push(...candidate.items);
                    processedIndices.add(j);
                }
            }

            mergedSubgroups.push({
                ...base,
                items: mergedItems
            });
            processedIndices.add(i);
        }
        family.subgroups = mergedSubgroups;
    });

    return NextResponse.json({ families });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
