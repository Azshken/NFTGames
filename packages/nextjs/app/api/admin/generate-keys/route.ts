import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

import { encrypt, generateCDKey, hashCDKey } from "~~/utils/crypto";

const MAX_QUANTITY = 100;

export async function POST(req: NextRequest) {
  const adminSecret = req.headers.get("x-admin-secret");

  // Explicit null/empty check prevents timing issues if ADMIN_SECRET is unset
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const quantity = Number(body.quantity ?? 10);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return NextResponse.json(
        { success: false, error: `Quantity must be an integer between 1 and ${MAX_QUANTITY}` },
        { status: 400 },
      );
    }

    const keys = [];

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
