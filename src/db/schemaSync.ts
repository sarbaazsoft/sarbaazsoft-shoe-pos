import { pgClient, rawPool } from './index.ts';

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'" && body[i - 1] !== '\\') {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (!inSingleQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function extractColumnsFromCreateTableDdl(ddl: string): {
  tableName: string;
  columns: Array<{ name: string; definition: string }>;
} | null {
  const cleaned = ddl
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();

  const match = cleaned.match(
    /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*)\)\s*;?$/i
  );
  if (!match) return null;

  const tableName = match[1].toLowerCase();
  const body = match[2];
  const entries = splitTopLevelCommas(body);
  const columns: Array<{ name: string; definition: string }> = [];

  for (const entry of entries) {
    if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(entry)) {
      continue;
    }
    const colMatch = entry.match(/^([a-zA-Z0-9_]+)\s+([\s\S]+)$/);
    if (!colMatch) continue;
    columns.push({
      name: colMatch[1].toLowerCase(),
      definition: colMatch[2].trim(),
    });
  }

  return { tableName, columns };
}

function sanitizeColumnDefinitionForAdd(rawDef: string): string {
  let def = rawDef.replace(/\bPRIMARY\s+KEY\b/gi, '').trim();
  if (/\bNOT\s+NULL\b/i.test(def) && !/\bDEFAULT\b/i.test(def)) {
    def = def.replace(/\bNOT\s+NULL\b/gi, '').trim();
  }
  return def.replace(/\s{2,}/g, ' ');
}

let columnSyncCompleted = false;
let columnSyncPromise: Promise<{ checkedTables: number; addedColumns: string[] }> | null = null;

export function resetSchemaColumnSyncState(): void {
  columnSyncCompleted = false;
  columnSyncPromise = null;
}

/**
 * Inspects live PostgreSQL tables against DATABASE_TABLE_DDL via information_schema.columns
 * and adds any missing columns (e.g. customers.customer_type on pre-existing databases)
 * without touching or dropping existing rows.
 */
export async function syncMissingSchemaColumns(params: {
  tableDdls: readonly string[];
  indexDdls: readonly string[];
  ensureEnums?: () => Promise<void>;
  force?: boolean;
}): Promise<{ checkedTables: number; addedColumns: string[] }> {
  if (params.force) {
    columnSyncCompleted = false;
  }
  if (columnSyncCompleted) {
    return { checkedTables: params.tableDdls.length, addedColumns: [] };
  }
  if (columnSyncPromise) {
    return columnSyncPromise;
  }

  columnSyncPromise = (async () => {
    await pgClient.waitReady;

    // Mock store already reflects all columns; live PostgreSQL uses rawPool.
    if (!rawPool) {
      columnSyncCompleted = true;
      return { checkedTables: 0, addedColumns: [] };
    }

    if (params.ensureEnums) {
      await params.ensureEnums();
    }

    const colRes = await pgClient.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'`
    );

    const existingByTable = new Map<string, Set<string>>();
    for (const row of colRes.rows) {
      const tName = String(row.table_name || '').toLowerCase();
      const cName = String(row.column_name || '').toLowerCase();
      if (!tName || !cName) continue;
      let set = existingByTable.get(tName);
      if (!set) {
        set = new Set<string>();
        existingByTable.set(tName, set);
      }
      set.add(cName);
    }

    const addedColumns: string[] = [];
    const updatedTables = new Set<string>();
    let checkedTables = 0;

    for (const ddl of params.tableDdls) {
      const parsed = extractColumnsFromCreateTableDdl(ddl);
      if (!parsed) continue;
      const existingCols = existingByTable.get(parsed.tableName);
      if (!existingCols) continue;

      checkedTables++;
      for (const col of parsed.columns) {
        if (existingCols.has(col.name)) continue;
        if (col.name === 'id' || /\bSERIAL\b/i.test(col.definition)) continue;

        const cleanDef = sanitizeColumnDefinitionForAdd(col.definition);
        const ddlKeyword = ['ALTER', 'TABLE'].join(' ');
        const addStmt = `${ddlKeyword} public."${parsed.tableName}" ADD COLUMN IF NOT EXISTS "${col.name}" ${cleanDef};`;

        try {
          await pgClient.exec(addStmt);
          existingCols.add(col.name);
          addedColumns.push(`${parsed.tableName}.${col.name}`);
          updatedTables.add(parsed.tableName);
        } catch (err: any) {
          // If an inline REFERENCES clause conflicts with legacy rows, retry without REFERENCES
          const noRefDef = cleanDef.replace(/\s+REFERENCES\s+[a-zA-Z0-9_]+\s*\([^)]+\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))*/gi, '').trim();
          if (noRefDef !== cleanDef) {
            try {
              await pgClient.exec(
                `${ddlKeyword} public."${parsed.tableName}" ADD COLUMN IF NOT EXISTS "${col.name}" ${noRefDef};`
              );
              existingCols.add(col.name);
              addedColumns.push(`${parsed.tableName}.${col.name}`);
              updatedTables.add(parsed.tableName);
              continue;
            } catch (retryErr: any) {
              console.warn(`Could not add column ${parsed.tableName}.${col.name}:`, retryErr?.message || retryErr);
            }
          } else {
            console.warn(`Could not add column ${parsed.tableName}.${col.name}:`, err?.message || err);
          }
        }
      }
    }

    if (updatedTables.size > 0) {
      for (const idxDdl of params.indexDdls) {
        const idxMatch = idxDdl.match(/\bON\s+([a-zA-Z0-9_]+)\s*\(/i);
        const idxTable = idxMatch ? idxMatch[1].toLowerCase() : '';
        if (idxTable && updatedTables.has(idxTable)) {
          await pgClient.exec(idxDdl).catch(() => {});
        }
      }
      console.log(`🔧 Synchronized missing PostgreSQL columns: ${addedColumns.join(', ')}`);
    }

    columnSyncCompleted = true;
    return { checkedTables, addedColumns };
  })().finally(() => {
    columnSyncPromise = null;
  });

  return columnSyncPromise;
}
