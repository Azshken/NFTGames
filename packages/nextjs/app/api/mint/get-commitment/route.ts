import { NextRequest, NextResponse } from "next/server";
import { getAvailableCDKey } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const { walletAddress } = body;

    if (!walletAddress) {
      return NextResponse.json({ success: false, error: "Wallet address required" }, { status: 400 });
    }

    // Validate Ethereum address format before hitting the database
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      return NextResponse.json({ success: false, error: "Invalid wallet address format" }, { status: 400 });
    }

    const cdkey = await getAvailableCDKey();

    if (!cdkey) {
      return NextResponse.json({ success: false, error: "No CD keys available" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      commitmentHash: cdkey.commitment_hash,
      cdkeyId: cdkey.id,
    });
  } catch (error: any) {
    console.error("Get Commitment API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
