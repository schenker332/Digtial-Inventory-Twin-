
import { prisma } from "./src/lib/prisma";

async function main() {
  console.log("Checking DB connection...");
  try {
      const items = await prisma.item.findMany({
          include: { cluster: true }
      });
      console.log(`Found ${items.length} items in DB directly.`);
  } catch (e) {
      console.error("DB Error:", e);
  }
}

main();
