import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";

import scaffoldConfig from "~~/scaffold.config";
import { decrypt, encryptWithPublicKey } from "~~/utils/crypto";
import { getCDKeyByTokenId, storeUserEncryptedKey } from "~~/utils/db";

export async function POST(req: NextRequest) {
  console.log("[redeem] handler called");
  try {
    const body = await req.json().catch(() => null);
    console.log("[redeem] body parsed:", body ? "ok" : "null");

    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const { tokenId, userAddress, userPublicKey } = body;
    console.log("[redeem] tokenId:", tokenId, "userAddress:", userAddress, "hasPublicKey:", !!userPublicKey);

    if (!tokenId || !userAddress || !userPublicKey) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Validate tokenId before BigInt conversion
    // Use the server-side runtime var in API routes — not inlined at build time
    const contractAddress = (process.env.CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS) as `0x${string}` | undefined;
    console.log("[redeem] contractAddress:", contractAddress);

    if (!contractAddress) {
      console.error("CONTRACT_ADDRESS is not set");
      return NextResponse.json({ success: false, error: "Server misconfiguration" }, { status: 500 });
    }

    // 1. Verify NFT ownership on-chain
    const rpcUrl = process.env.ALCHEMY_RPC_URL;
    if (!rpcUrl) {
      console.error("ALCHEMY_RPC_URL is not set");
      return NextResponse.json({ success: false, error: "Server misconfiguration: missing RPC" }, { status: 500 });
    }

    const targetChain = scaffoldConfig.targetNetworks[0];

    const publicClient = createPublicClient({
      chain: targetChain,
      transport: http(rpcUrl),
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
    console.log("[redeem] cdkeyRecord found:", !!cdkeyRecord);
    console.log("[redeem] encrypted_cdkey length:", cdkeyRecord?.encrypted_cdkey?.length);
    console.log("[redeem] encrypted_cdkey prefix:", cdkeyRecord?.encrypted_cdkey?.slice(0, 20));
    console.log("[redeem] user_encrypted_key exists:", !!cdkeyRecord?.user_encrypted_key);

    if (!cdkeyRecord) {
      console.log("[redeem] returning already-encrypted key");
      return NextResponse.json({ success: false, error: "CD key not found or already redeemed" }, { status: 404 });
    }

    console.log("[redeem] attempting server-side decrypt...");
    console.log("[redeem] ENCRYPTION_KEY set:", !!process.env.ENCRYPTION_KEY);
    console.log("[redeem] ENCRYPTION_KEY length:", process.env.ENCRYPTION_KEY?.length);
    
    // 3. If already re-encrypted for this user, return all required fields
    if (cdkeyRecord.user_encrypted_key) {
      return NextResponse.json({
        success: true,
        encryptedCDKey: cdkeyRecord.user_encrypted_key,
        commitmentHash: cdkeyRecord.commitment_hash,
        cdkeyId: cdkeyRecord.id.toString(),
        alreadyEncrypted: true,
      });
    }

    // 4. Decrypt CDKey (only time this happens server-side)
    const plaintextCDKey = decrypt(cdkeyRecord.encrypted_cdkey);

    // 5. Re-encrypt with user's MetaMask public key
    const encryptedForUser = encryptWithPublicKey(plaintextCDKey, userPublicKey);

    // 6. Store user-encrypted key in database
    await storeUserEncryptedKey(cdkeyRecord.id, encryptedForUser);

    return NextResponse.json({
      success: true,
      encryptedCDKey: encryptedForUser,
      commitmentHash: cdkeyRecord.commitment_hash,
      cdkeyId: cdkeyRecord.id.toString(),
    });
  } catch (error: any) {
    console.error("Redeem API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
