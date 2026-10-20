import { NextResponse } from "next/server";
import { getDb } from "@/lib/database/client";
import { getPublicCredential, parseCredentialRef } from "@/server/public/read";

export const dynamic = "force-dynamic";

/**
 * The public evidence bundle for one credential (JSON). Same rules as the verifier page: only a record the holder
 * published, and a malformed, unknown or unpublished reference is an identical 404. The bundle contains no private fields.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ credentialRef: string }> }) {
  const { credentialRef } = await params;
  const ref = parseCredentialRef(credentialRef);
  const view = ref ? await getPublicCredential(getDb(), ref) : null;
  if (!ref || !view || !view.bundle) return NextResponse.json({ error: "Not available" }, { status: 404 });
  return new NextResponse(JSON.stringify(view.bundle, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="farji-evidence-${ref.slice(2, 10)}.json"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
