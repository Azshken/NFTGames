// packages/nextjs/app/api/redeem/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import scaffoldConfig from "~~/scaffold.config";
import { decrypt, encryptWithPublicKey } from "~~/utils/crypto";
import { getCDKeyByTokenId } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const { tokenId, userAddress, userPublicKey } = await req.json();

    // 1. Verify NFT ownership on-chain
    const publicClient = createPublicClient({
      chain: scaffoldConfig.targetNetworks[0],
      transport: http(),
    });

    const owner = await publicClient.readContract({
      address: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`,
      abi: parseAbi(["function ownerOf(uint256) view returns (address)"]),
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    });

    if (owner.toLowerCase() !== userAddress.toLowerCase()) {
      return NextResponse.json({ error: "Not NFT owner" }, { status: 403 });
    }

    // 2. Get CDKey from database
    const cdkeyRecord = await getCDKeyByTokenId(BigInt(tokenId));

    if (!cdkeyRecord) {
      return NextResponse.json({ error: "CDKey not found or already redeemed" }, { status: 404 });
    }

    // 3. Decrypt CDKey
    const plaintextCDKey = decrypt(cdkeyRecord.encrypted_cdkey);

    // 4. Encrypt with user's public key
    const encryptedForUser = encryptWithPublicKey(plaintextCDKey, userPublicKey);

    return NextResponse.json({
      success: true,
      encryptedCDKey: encryptedForUser,
      commitmentHash: cdkeyRecord.commitment_hash,
      cdkeyId: cdkeyRecord.id,
    });
  } catch (error: any) {
    console.error("Redeem error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
