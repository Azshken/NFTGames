// packages/nextjs/app/api/mint/get-commitment/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAvailableCDKey } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const { walletAddress } = await req.json();

    if (!walletAddress) {
      return NextResponse.json({ error: "Wallet address required" }, { status: 400 });
    }

    const cdkey = await getAvailableCDKey();

    if (!cdkey) {
      return NextResponse.json({ error: "No CD keys available" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      commitmentHash: cdkey.commitment_hash,
      cdkeyId: cdkey.id,
    });
  } catch (error: any) {
    console.error("Get commitment error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
