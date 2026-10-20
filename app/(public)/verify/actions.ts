"use server";

import { redirect } from "next/navigation";
import { parseCredentialRef } from "@/server/public/read";

/**
 * Looks up a credential from a pasted verification link or reference. Only a well-formed reference is followed; anything
 * else returns to the form. There is no search and no listing: a reference is the only way in.
 */
export async function lookupCredentialAction(formData: FormData): Promise<void> {
  const raw = formData.get("reference");
  const text = typeof raw === "string" ? raw.slice(0, 500) : "";
  const match = /0x[0-9a-fA-F]{64}/.exec(text);
  const ref = match ? parseCredentialRef(match[0]) : null;
  redirect(ref ? `/verify/${ref}` : "/verify?invalid=1");
}
