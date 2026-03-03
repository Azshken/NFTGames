// SPDX-License-Identifier: AGPL-3.0-only
// packages/nextjs/app/api/redeem/confirm/route.ts
import { NextRequest, NextResponse } from "next/server";

import { confirmRedemption, recordReserveRelease } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });

    const { cdkeyId, userAddress, txHash, blockNumber } = body;

    if (!cdkeyId || !userAddress || !txHash || !blockNumber) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // 1. Finalise redemption record: set redeemed_by, redeemed_at, tx data;
    //    also nulls out encrypted_key on the cd_keys row (server key no longer needed)
    await confirmRedemption({
      cdkeyId: Number(cdkeyId),
      redeemedBy: userAddress,
      redemptionTxHash: txHash,
      blockNumber: BigInt(blockNumber),
    });

    // 2. Record reserve release (claim path) — vault emits ReserveReleased on claimCdKey
    await recordReserveRelease({
      cdkeyId: Number(cdkeyId),
      releaseReason: "claim",
      txHash,
      blockNumber: BigInt(blockNumber),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Redeem Confirm API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
