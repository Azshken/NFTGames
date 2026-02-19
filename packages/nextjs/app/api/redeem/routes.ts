import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import scaffoldConfig from "~~/scaffold.config";
import { decrypt, encryptWithPublicKey } from "~~/utils/crypto";
import { getCDKeyByTokenId, storeUserEncryptedKey } from "~~/utils/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const { tokenId, userAddress, userPublicKey } = body;

    if (!tokenId || !userAddress || !userPublicKey) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Validate tokenId before BigInt conversion
    const tokenIdNum = Number(tokenId);
    if (!Number.isFinite(tokenIdNum) || !Number.isInteger(tokenIdNum) || tokenIdNum < 0) {
      return NextResponse.json({ success: false, error: "Invalid tokenId" }, { status: 400 });
    }

    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;
    if (!contractAddress) {
      console.error("NEXT_PUBLIC_CONTRACT_ADDRESS is not set");
      return NextResponse.json({ success: false, error: "Server misconfiguration" }, { status: 500 });
    }

    // 1. Verify NFT ownership on-chain
    const publicClient = createPublicClient({
      chain: scaffoldConfig.targetNetworks[0],
      transport: http(),
    });

    const owner = await publicClient.readContract({
      address: contractAddress,
      abi: parseAbi(["function ownerOf(uint256) view returns (address)"]),
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    });

    if (owner.toLowerCase() !== userAddress.toLowerCase()) {
      return NextResponse.json({ success: false, error: "Not NFT owner" }, { status: 403 });
    }

    // 2. Get CDKey from database
    const cdkeyRecord = await getCDKeyByTokenId(BigInt(tokenId));

    if (!cdkeyRecord) {
      return NextResponse.json({ success: false, error: "CD key not found or already redeemed" }, { status: 404 });
    }

    // 3. If user-encrypted key already exists, return it WITH all required fields
    //    (commitmentHash + cdkeyId were missing here — caused frontend crash on .startsWith)
    if (cdkeyRecord.user_encrypted_key) {
      return NextResponse.json({
        success: true,
        encryptedCDKey: cdkeyRecord.user_encrypted_key,
        commitmentHash: cdkeyRecord.commitment_hash,
        cdkeyId: cdkeyRecord.id,
        alreadyEncrypted: true,
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
    console.error("Redeem API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
