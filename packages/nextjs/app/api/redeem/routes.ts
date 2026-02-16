// packages/nextjs/app/api/redeem/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import scaffoldConfig from "~~/scaffold.config";
import { decrypt, encryptWithPublicKey } from "~~/utils/crypto";
import { getCDKeyByTokenId, storeUserEncryptedKey } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const { tokenId, userAddress, userPublicKey } = await req.json();

    if (!tokenId || !userAddress || !userPublicKey) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

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
      return NextResponse.json({ error: "CD key not found or already redeemed" }, { status: 404 });
    }

    // 3. Check if already has user-encrypted key
    if (cdkeyRecord.user_encrypted_key) {
      return NextResponse.json({
        success: true,
        encryptedCDKey: cdkeyRecord.user_encrypted_key,
        alreadyRedeemed: true,
      });
    }

    // 4. Decrypt CDKey (only time this happens!)
    const plaintextCDKey = decrypt(cdkeyRecord.encrypted_cdkey);

    // 5. Encrypt with user's MetaMask public key
    const encryptedForUser = encryptWithPublicKey(plaintextCDKey, userPublicKey);

    // 6. Store user-encrypted key in database
    await storeUserEncryptedKey(cdkeyRecord.id, encryptedForUser);

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
