// packages/nextjs/app/api/mint/get-commitment/route.ts
import { NextResponse } from "next/server";
import { getAvailableCDKey } from "~~/utils/db";

export async function POST() {
  try {
    const cdkey = await getAvailableCDKey();

    if (!cdkey) {
      return NextResponse.json({ error: "No CDKeys available" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      commitmentHash: cdkey.commitment_hash,
      cdkeyId: cdkey.id,
    });
  } catch (error: any) {
    console.error("Get commitment error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
