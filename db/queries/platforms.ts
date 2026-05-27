import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformFieldMappings } from "@/db/schema";
import type {
  InternalField,
  PlatformAdapter,
} from "@/csv/platforms/types";
import { ADAPTERS } from "@/csv/platforms";

export type Platform = PlatformAdapter["platform"];

export interface MappingRow {
  id: string;
  platform: Platform;
  internalField: InternalField;
  headerName: string;
  priority: number;
}

export async function listAllMappings(): Promise<MappingRow[]> {
  const rows = await db
    .select({
      id: platformFieldMappings.id,
      platform: platformFieldMappings.platform,
      internalField: platformFieldMappings.internalField,
      headerName: platformFieldMappings.headerName,
      priority: platformFieldMappings.priority,
    })
    .from(platformFieldMappings)
    .orderBy(
      asc(platformFieldMappings.platform),
      asc(platformFieldMappings.internalField),
      asc(platformFieldMappings.priority),
      asc(platformFieldMappings.headerName),
    );
  return rows.map((r) => ({
    ...r,
    platform: r.platform as Platform,
    internalField: r.internalField as InternalField,
  }));
}

export async function listMappingsForPlatform(
  platform: Platform,
): Promise<MappingRow[]> {
  const rows = await db
    .select({
      id: platformFieldMappings.id,
      platform: platformFieldMappings.platform,
      internalField: platformFieldMappings.internalField,
      headerName: platformFieldMappings.headerName,
      priority: platformFieldMappings.priority,
    })
    .from(platformFieldMappings)
    .where(eq(platformFieldMappings.platform, platform))
    .orderBy(
      asc(platformFieldMappings.internalField),
      asc(platformFieldMappings.priority),
      asc(platformFieldMappings.headerName),
    );
  return rows.map((r) => ({
    ...r,
    platform: r.platform as Platform,
    internalField: r.internalField as InternalField,
  }));
}

/**
 * Resolves the adapter for a platform by combining the DB mappings (mutable,
 * admin-edited) with the hard-coded `requiredFields`, `acceptedDateFormats`,
 * and `skipRow` rule from the code-level adapter. Falls back to the
 * hard-coded `headerMap` candidates if the DB has none for a (platform,field).
 */
export async function resolveAdapter(
  platform: Platform,
): Promise<PlatformAdapter> {
  const base = ADAPTERS[platform];
  const rows = await listMappingsForPlatform(platform);
  const grouped: Partial<Record<InternalField, string[]>> = {};
  for (const r of rows) {
    const list = grouped[r.internalField] ?? (grouped[r.internalField] = []);
    list.push(r.headerName);
  }

  // Merge DB-resolved candidates with code defaults so missing rows fall back.
  const headerMap = { ...base.headerMap } as Record<InternalField, string[]>;
  for (const field of Object.keys(grouped) as InternalField[]) {
    const dbList = grouped[field];
    if (dbList && dbList.length > 0) {
      headerMap[field] = dbList;
    }
  }

  return { ...base, headerMap };
}

