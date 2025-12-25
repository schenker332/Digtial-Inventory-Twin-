
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.item.findMany({
    include: {
      analysisCache: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  console.log("\n--- AKTUELLE ITEMS IN DER DATENBANK ---\n");
  console.log(`${"NAME".padEnd(40)} | ${"PREIS".padEnd(10)} | ${"EMAIL SUBJECT"}`);
  console.log("-".repeat(90));

  items.forEach(item => {
    let subject = "Kein Betreff";
    try {
        const result = JSON.parse(item.analysisCache?.resultJson || "{}");
        // Wir versuchen den Betreff aus dem Cache zu fischen
        // In deinem route.ts wurde expertResult gespeichert, das hat aber kein subject.
        // Das Subject steht aber im debug_input_gatekeeper oder wir nehmen die Mail ID.
        subject = item.analysisCacheId || "Unknown";
    } catch (e) {}

    const name = item.name.length > 37 ? item.name.substring(0, 37) + "..." : item.name;
    const price = `${item.price || "?.??"} ${item.currency || ""}`;
    
    console.log(`${name.padEnd(40)} | ${price.padEnd(10)} | ID: ${subject}`);
  });
  
  console.log(`\nGesamtanzahl: ${items.length} Items`);
}

main().finally(() => prisma.$disconnect());
