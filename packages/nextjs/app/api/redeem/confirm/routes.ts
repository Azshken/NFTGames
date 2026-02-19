import { NextRequest, NextResponse } from "next/server";
import { markCDKeyRedeemed } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const { cdkeyId, userAddress, txHash } = body;

    if (!cdkeyId || !userAddress || !txHash) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // x-forwarded-for can be comma-separated when behind multiple proxies — take first (real client) IP
    const rawIp = req.headers.get("x-forwarded-for");
    const ipAddress = rawIp ? rawIp.split(",")[0].trim() : undefined;

    await markCDKeyRedeemed(cdkeyId, userAddress, txHash, ipAddress);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Redeem Confirm API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
