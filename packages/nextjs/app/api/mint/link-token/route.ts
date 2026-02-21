// packages/nextjs/app/api/mint/link-token/route.ts
import { NextRequest, NextResponse } from "next/server";

import { linkCDKeyToToken } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const { cdkeyId, tokenId, walletAddress } = body;

    if (!cdkeyId || !tokenId || !walletAddress) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Validate tokenId is a safe integer before BigInt conversion
    const tokenIdNum = Number(tokenId);
    if (!Number.isFinite(tokenIdNum) || !Number.isInteger(tokenIdNum) || tokenIdNum < 0) {
      return NextResponse.json({ success: false, error: "Invalid tokenId" }, { status: 400 });
    }

    await linkCDKeyToToken(cdkeyId, BigInt(tokenId), walletAddress);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Link Token API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
