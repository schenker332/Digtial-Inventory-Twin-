import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    // 1. Fetch all cache entries
    const allCache = await prisma.analysisCache.findMany({
      where: {
        isRelevant: true, // Only relevant mails have items
      },
      include: {
        items: true // Check if already synced
      }
    });

    let createdCount = 0;
    let skippedCount = 0;

    for (const cache of allCache) {
      if (cache.items.length > 0) {
        skippedCount++;
        continue; // Already synced
      }

      const result = JSON.parse(cache.resultJson);
      const items = result.items || [];

      if (!Array.isArray(items) || items.length === 0) {
        continue;
      }

      // Create items
      for (const item of items) {
        // Safe parsing for price
        let priceValue = null;
        if (item.price) {
           const cleanedPrice = String(item.price).replace(/[^0-9.,]/g, "").replace(",", ".");
           const parsed = parseFloat(cleanedPrice);
           if (!isNaN(parsed)) priceValue = parsed;
        }

        // Try to parse buyDate from debug inputs or use cache.createdAt as fallback
        // The email date is in 'debugInputE' sometimes inside "Date: ..."
        // For now, let's just use cache.createdAt as buyDate approximation if not parsed
        // Or if 'expert' result has a date? No, only items.
        
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
      }
    }

    return NextResponse.json({
      message: "Sync complete",
      created: createdCount,
      skipped_caches: skippedCount
    });

  } catch (error: any) {
    console.error("Sync Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
