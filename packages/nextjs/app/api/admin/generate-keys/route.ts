// packages/nextjs/app/api/admin/generate-keys/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { encrypt, generateCDKey, hashCDKey } from "~~/utils/crypto";

export async function POST(req: NextRequest) {
  try {
    const { quantity = 10 } = await req.json();

    const keys = [];

    for (let i = 0; i < quantity; i++) {
      const cdkey = generateCDKey();
      const commitmentHash = hashCDKey(cdkey);
      const encryptedCDKey = encrypt(cdkey);

      await sql`
        INSERT INTO cdkeys (encrypted_cdkey, commitment_hash)
        VALUES (${encryptedCDKey}, ${commitmentHash})
      `;

      keys.push({ cdkey, commitmentHash });
    }

    return NextResponse.json({
      success: true,
      count: keys.length,
      keys,
    });
  } catch (error: any) {
    console.error("Generate keys error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
