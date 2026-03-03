// SPDX-License-Identifier: AGPL-3.0-only
// packages/nextjs/app/api/mint/link-token/route.ts
import { NextRequest, NextResponse } from "next/server";

import { createMint } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });

    const { cdkeyId, tokenId, walletAddress, txHash, blockNumber, paymentToken, paymentAmount } = body;

    if (!cdkeyId || !tokenId || !walletAddress || !txHash || !blockNumber || !paymentToken || !paymentAmount) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const tokenIdNum = Number(tokenId);
    if (!Number.isFinite(tokenIdNum) || !Number.isInteger(tokenIdNum) || tokenIdNum < 0) {
      return NextResponse.json({ success: false, error: "Invalid tokenId" }, { status: 400 });
    }

    // INSERT into mints table — replaces the old UPDATE cdkeys SET token_id = ...
    await createMint({
      cdkeyId: Number(cdkeyId),
      tokenId: BigInt(tokenId),
      mintedBy: walletAddress,
      mintTxHash: txHash,
      blockNumber: BigInt(blockNumber),
      paymentToken, // address(0) for ETH, ERC-20 address for USDT/USDC
      paymentAmount, // raw wei / token units as string
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Link Token API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
