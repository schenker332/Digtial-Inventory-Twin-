import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const clusters = await prisma.cluster.findMany({
      include: {
        items: {
          orderBy: { buyDate: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // NEU: Finde Items ohne Cluster (Waisen)
    const unclusteredItems = await prisma.item.findMany({
        where: { clusterId: null },
        orderBy: { buyDate: 'desc' }
    });

    const summary = clusters.map(c => {
      // Extrahiere alle einzigartigen Familiennamen, die in diesen Cluster geflossen sind
      const uniqueFamilies = Array.from(new Set(c.items.map(i => i.originalFamily).filter(f => f !== null)));
      
      return {
        clusterName: c.name,
        mergedFamilies: uniqueFamilies,
        items: c.items.map(i => ({
            id: i.id,
            name: i.name,
            price: i.price,
            currency: i.currency,
            shop: i.shop,
            buyDate: i.buyDate,
            mailId: i.analysisCacheId
        }))
      };
    });

    const unclustered = unclusteredItems.map(i => ({
        id: i.id,
        name: i.name,
        price: i.price,
        currency: i.currency,
        shop: i.shop,
        buyDate: i.buyDate,
        mailId: i.analysisCacheId
    }));

    return NextResponse.json({ summary, unclustered });
  } catch (error: any) {
    console.error("Inventory Summary Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
