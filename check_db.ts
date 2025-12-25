
import { prisma } from "./src/lib/prisma";

async function main() {
  const entry = await prisma.analysisCache.findFirst({
    where: { isRelevant: true }
  });
  console.log("--- WAS IN DER DATENBANK STEHT (ROHTEXT) ---");
  console.log(entry?.resultJson);
}

main();
