import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { createPublicClient, http, parseAbi, verifyMessage } from "viem";

import scaffoldConfig from "~~/scaffold.config";
import { encrypt, generateCDKey, hashCDKey } from "~~/utils/crypto";

const MAX_QUANTITY = 1000;
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000; // 5 minutes

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const { quantity: rawQuantity, walletAddress, signature, message, timestamp } = body;

    if (!walletAddress || !signature || !message || !timestamp) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // 1. Reject stale signatures — prevents replay attacks
    const messageAge = Date.now() - Number(timestamp);
    if (messageAge > MAX_MESSAGE_AGE_MS || messageAge < 0) {
      return NextResponse.json({ success: false, error: "Signature expired, please try again" }, { status: 401 });
    }

    // 2. Verify the signature was produced by walletAddress
    const isValidSignature = await verifyMessage({
      address: walletAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValidSignature) {
      return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
    }

    // 3. Verify walletAddress is the contract owner on-chain — single source of truth
    const targetChain = scaffoldConfig.targetNetworks[0];
    const contractAddress = (process.env.CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS) as
      | `0x${string}`
      | undefined;

    if (!contractAddress) {
      return NextResponse.json(
        { success: false, error: "Server misconfiguration: contract address not set" },
        { status: 500 },
      );
    }

    const publicClient = createPublicClient({
      chain: targetChain,
      transport: http(process.env.ALCHEMY_RPC_URL),
    });

    const contractOwner = await publicClient.readContract({
      address: contractAddress,
      abi: parseAbi(["function owner() view returns (address)"]),
      functionName: "owner",
    });

    if (contractOwner.toLowerCase() !== walletAddress.toLowerCase()) {
      console.warn(`Unauthorized generate-keys attempt from ${walletAddress}, owner is ${contractOwner}`);
      return NextResponse.json({ success: false, error: "Unauthorized: not the contract owner" }, { status: 403 });
    }

    // 4. Validate quantity
    const quantity = Number(rawQuantity ?? 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return NextResponse.json(
        { success: false, error: `Quantity must be an integer between 1 and ${MAX_QUANTITY}` },
        { status: 400 },
      );
    }

    // 5. Generate and store keys
    const keys: { commitmentHash: string }[] = [];

    for (let i = 0; i < quantity; i++) {
      const cdkey = generateCDKey();
      const commitmentHash = hashCDKey(cdkey);
      const encryptedCDKey = encrypt(cdkey);

      await sql`
        INSERT INTO cdkeys (encrypted_cdkey, commitment_hash, is_redeemed)
        VALUES (${encryptedCDKey}, ${commitmentHash}, FALSE)
      `;

      keys.push({ commitmentHash });
    }

    const allHashes = await sql`
      SELECT commitment_hash FROM cdkeys WHERE is_redeemed = FALSE
    `;

    return NextResponse.json({
      success: true,
      count: keys.length,
      keys,
      totalAvailable: allHashes.rows.length,
    });
  } catch (error: any) {
    console.error("Generate Keys API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
