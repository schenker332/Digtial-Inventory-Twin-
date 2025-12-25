
import { prisma } from "./src/lib/prisma";

// Kopie der Logik zum Testen
function getExactKey(name: string) {
  return name.trim().toLowerCase();
}
function getFamilyKey(name: string) {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") 
    .split(/\s+/) 
    .filter(t => t.length > 2) 
    .sort(); 
  return tokens.slice(0, 3).join(" "); 
}

async function main() {
    const items = await prisma.item.findMany(); // Mock fetch
    
    const exactGroups: Record<string, any[]> = {};
    items.forEach(item => {
      const exactKey = getExactKey(item.name);
      if (!exactGroups[exactKey]) exactGroups[exactKey] = [];
      exactGroups[exactKey].push(item);
    });

    const families: Record<string, any> = {};

    Object.entries(exactGroups).forEach(([exactName, groupItems]) => {
      const representativeName = groupItems[0].name;
      const familyKey = getFamilyKey(representativeName);

      if (!families[familyKey]) {
        families[familyKey] = {
          familyName: representativeName, 
          subgroups: []
        };
      }
      families[familyKey].subgroups.push({
        name: representativeName, 
        count: groupItems.length
      });
    });

    console.log(JSON.stringify(Object.values(families).slice(0, 3), null, 2));
}

main();
