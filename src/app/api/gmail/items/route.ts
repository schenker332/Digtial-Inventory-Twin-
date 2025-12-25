import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Level 1: Exakte Übereinstimmung (bereinigt)
function getExactKey(name: string) {
  return name.trim().toLowerCase();
}

// Level 2: Familien-Zugehörigkeit (Wort-basiert, toleranter)
function getFamilyKey(name: string) {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") 
    .split(/\s+/) 
    .filter(t => t.length > 2) 
    .sort(); 
  
  // Die ersten 3 signifikanten Wörter definieren die "Familie"
  return tokens.slice(0, 3).join(" "); 
}

export async function GET() {
  try {
    const items = await prisma.item.findMany({
      include: {
        cluster: true,
      },
      orderBy: {
        buyDate: 'desc'
      }
    });

    // 1. Erstmal alles streng gruppieren (Exact Match)
    const exactGroups: Record<string, any[]> = {};
    items.forEach(item => {
      const exactKey = getExactKey(item.name);
      if (!exactGroups[exactKey]) exactGroups[exactKey] = [];
      exactGroups[exactKey].push(item);
    });

    // 2. Jetzt die strengen Gruppen zu Familien zusammenfassen
    const families: Record<string, { familyName: string, subgroups: any[] }> = {};

    Object.entries(exactGroups).forEach(([exactName, groupItems]) => {
      // Wir nehmen den Namen des ersten Items der Gruppe, um den Familien-Key zu bestimmen
      const representativeName = groupItems[0].name;
      const familyKey = getFamilyKey(representativeName);

      if (!families[familyKey]) {
        families[familyKey] = {
          familyName: representativeName, // Der Name der Familie ist erstmal der Name des ersten Mitglieds
          subgroups: []
        };
      }
      
      // Wir fügen die ganze exakte Gruppe als Untergruppe zur Familie hinzu
      families[familyKey].subgroups.push({
        name: representativeName, // Name dieser spezifischen Variante
        items: groupItems
      });
    });

    // Wir geben nur die Werte zurück (Array von Familien)
    return NextResponse.json({ 
      families: Object.values(families).sort((a, b) => {
        // Sortieren nach Größe der Familie (Anzahl aller Items in allen Subgroups)
        const countA = a.subgroups.reduce((acc, sg) => acc + sg.items.length, 0);
        const countB = b.subgroups.reduce((acc, sg) => acc + sg.items.length, 0);
        return countB - countA;
      })
    });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
