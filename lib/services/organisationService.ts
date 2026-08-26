import { organisations } from "@/lib/mock-data/organisations";
import type { Organisation } from "@/lib/mock-data/types";

// Every UI component reads through this file rather than importing
// lib/mock-data directly. In Review 3 this is the only file that changes
// to read from Supabase instead — the function signatures stay the same.

export function getOrganisations(): Organisation[] {
  return organisations;
}

export function getOrganisationById(organisationId: string): Organisation | undefined {
  return organisations.find((org) => org.organisationId === organisationId);
}
