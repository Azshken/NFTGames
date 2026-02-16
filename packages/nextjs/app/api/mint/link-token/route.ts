// packages/nextjs/app/api/mint/link-token/route.ts
import { NextRequest, NextResponse } from "next/server";
import { linkCDKeyToToken } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const { cdkeyId, tokenId, walletAddress } = await req.json();

    if (!cdkeyId || !tokenId || !walletAddress) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await linkCDKeyToToken(cdkeyId, BigInt(tokenId), walletAddress);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Link token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
