import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const lastLog = await prisma.processLog.findUnique({
      where: { id: 'LATEST_RUN' }
    });

    if (!lastLog) {
      return NextResponse.json({ log: null });
    }

    return NextResponse.json({
      log: {
        model: lastLog.model,
        systemPrompt: lastLog.systemPrompt,
        input: JSON.parse(lastLog.inputJson),
        output: JSON.parse(lastLog.outputJson),
        createdAt: lastLog.createdAt
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}