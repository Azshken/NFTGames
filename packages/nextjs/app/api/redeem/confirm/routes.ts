// packages/nextjs/app/api/redeem/confirm/route.ts
import { NextRequest, NextResponse } from "next/server";
import { markCDKeyRedeemed } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const { cdkeyId, userAddress, txHash } = await req.json();
    const ipAddress = req.headers.get("x-forwarded-for") || undefined;

    await markCDKeyRedeemed(cdkeyId, userAddress, txHash, ipAddress);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Confirm redemption error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
