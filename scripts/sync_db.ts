
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting Sync...");

  // 1. Fetch all cache entries
  const allCache = await prisma.analysisCache.findMany({
    where: {
      isRelevant: true, 
    },
    include: {
      items: true // Check if already synced
    }
  });

  console.log(`Found ${allCache.length} relevant cache entries.`);

  let createdCount = 0;
  let skippedCount = 0;

  for (const cache of allCache) {
    if (cache.items.length > 0) {
      skippedCount++;
      continue; // Already synced
    }

    let result;
    try {
        result = JSON.parse(cache.resultJson);
    } catch (e) {
        console.error(`Failed to parse JSON for Cache ID ${cache.id}`);
        continue;
    }

    const items = result.items || [];

    if (!Array.isArray(items) || items.length === 0) {
      continue;
    }

    // Create items
    for (const item of items) {
      // Safe parsing for price
      let priceValue = null;
      if (item.price) {
         // remove currency symbols, keep numbers, dots, commas
         const cleanedPrice = String(item.price).replace(/[^0-9.,]/g, "").replace(",", ".");
         const parsed = parseFloat(cleanedPrice);
         if (!isNaN(parsed)) priceValue = parsed;
      }

      await prisma.item.create({
        data: {
          name: item.name || "Unknown Item",
          price: priceValue,
          currency: item.currency || "EUR",
          shop: item.shop,
          buyDate: cache.createdAt, // Fallback
          analysisCacheId: cache.id
        }
      });
      createdCount++;
      process.stdout.write("."); // Progress indicator
    }
  }

  console.log("\n--- SYNC COMPLETE ---");
  console.log(`Created Items: ${createdCount}`);
  console.log(`Skipped Caches (already synced): ${skippedCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
