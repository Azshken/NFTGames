// SPDX-License-Identifier: AGPL-3.0-only
// packages/nextjs/app/api/admin/register-game/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { createPublicClient, http, parseAbi, verifyMessage } from "viem";

import scaffoldConfig from "~~/scaffold.config";

const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });

    const {
      walletAddress,
      contractAddress, // the SoulKey address to register
      gameName,
      genre,
      description,
      signature,
      message,
      timestamp,
    } = body;

    if (!walletAddress || !contractAddress || !gameName || !signature || !message || !timestamp) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    for (const addr of [walletAddress, contractAddress]) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        return NextResponse.json({ success: false, error: `Invalid address: ${addr}` }, { status: 400 });
      }
    }

    // 1. Reject stale signatures
    const messageAge = Date.now() - Number(timestamp);
    if (messageAge > MAX_MESSAGE_AGE_MS || messageAge < 0) {
      return NextResponse.json({ success: false, error: "Signature expired" }, { status: 401 });
    }

    // 2. Verify signature
    const isValidSig = await verifyMessage({
      address: walletAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    if (!isValidSig) {
      return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
    }

    const publicClient = createPublicClient({
      chain: scaffoldConfig.targetNetworks[0],
      transport: http(process.env.ALCHEMY_RPC_URL),
    });

    // 3. Verify caller is the SoulKey contract owner on-chain
    const contractOwner = await publicClient.readContract({
      address: contractAddress as `0x${string}`,
      abi: parseAbi(["function owner() view returns (address)"]),
      functionName: "owner",
    });
    if (contractOwner.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json({ success: false, error: "Unauthorized: not the contract owner" }, { status: 403 });
    }

    // 4. Verify game is registered in the vault — prevents phantom DB entries
    const vaultAddress = await publicClient.readContract({
      address: contractAddress as `0x${string}`,
      abi: parseAbi(["function vault() view returns (address)"]),
      functionName: "vault",
    });
    const isRegistered = await publicClient.readContract({
      address: vaultAddress as `0x${string}`,
      abi: parseAbi(["function registeredGames(address) view returns (bool)"]),
      functionName: "registeredGames",
      args: [contractAddress as `0x${string}`],
    });
    if (!isRegistered) {
      return NextResponse.json(
        { success: false, error: "Contract is not registered in MasterKeyVault. Call registerGame() first." },
        { status: 400 },
      );
    }

    // 5. Upsert product row — safe to call for the initial deployment too
    const result = await sql`
      INSERT INTO products (contract_address, name, genre, description)
      VALUES (${contractAddress.toLowerCase()}, ${gameName}, ${genre ?? ""}, ${description ?? ""})
      ON CONFLICT (contract_address) DO UPDATE
        SET name        = EXCLUDED.name,
            genre       = EXCLUDED.genre,
            description = EXCLUDED.description
      RETURNING product_id, contract_address, name
    `;

    const product = result.rows[0];
    return NextResponse.json({ success: true, product });
  } catch (error: any) {
    console.error("Register Game API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
