// app/api/nft/[contractAddress]/[tokenId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { createPublicClient, getAddress, http, parseAbi } from "viem";

import scaffoldConfig from "~~/scaffold.config";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contractAddress: string; tokenId: string }> },
) {
  try {
    const { contractAddress: rawAddress, tokenId: rawTokenId } = await params; // checksum normalise
    const contractAddress = getAddress(rawAddress);
    const tokenId = BigInt(rawTokenId);

    const result = await sql`
      SELECT name, genre, description, image_cid
      FROM products
      WHERE LOWER(contract_address) = LOWER(${contractAddress})
      LIMIT 1
    `;
    if (!result.rows[0]) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    const { name, genre, description, image_cid } = result.rows[0];

    // After fetching product from DB, also check for frozen metadata:
    const redemptionResult = await sql`
      SELECT r.frozen_metadata_cid
      FROM mints m
      JOIN redemptions r ON r.cdkey_id = m.cdkey_id
      WHERE m.token_id = ${tokenId.toString()}
      AND r.frozen_metadata_cid IS NOT NULL
      LIMIT 1
    `;

    const frozenCid = redemptionResult.rows[0]?.frozen_metadata_cid ?? null;

    if (frozenCid) {
      // Permanent redirect to IPFS — this response never changes
      return NextResponse.redirect(
        `https://ipfs.io/ipfs/${frozenCid}`,
        { status: 301 }  // 301 = permanent, marketplaces cache this
      );
    }
    // No frozen CID — token is unclaimed, serve dynamic JSON
    
    // Dynamic on-chain status — Unclaimed vs Soulbound
    let status = "Unclaimed";
    try {
      const publicClient = createPublicClient({
        chain: scaffoldConfig.targetNetworks[0],
        transport: http(process.env.ALCHEMY_RPC_URL),
      });
      const claimTs = await publicClient.readContract({
        address: contractAddress,
        abi: parseAbi(["function getClaimTimestamp(uint256) view returns (uint256)"]),
        functionName: "getClaimTimestamp",
        args: [tokenId],
      });
      if (claimTs > 0n) status = "Soulbound";
    } catch {
      // token not yet minted or RPC hiccup — default to Unclaimed
    }

    const metadata = {
      name: `${name} CD Key #${tokenId}`,
      description: description || `A game key for ${name}. Claim it on-chain to receive your CD key.`,
      image: image_cid ? `ipfs://${image_cid}` : "",
      external_url: process.env.NEXT_PUBLIC_APP_URL ?? "",
      attributes: [
        { trait_type: "Game", value: name },
        { trait_type: "Genre", value: genre },
        { trait_type: "Status", value: status },
      ],
    };

    return NextResponse.json(metadata, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
