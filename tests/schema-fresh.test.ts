import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DATABASE_ENUM_DDL,
  DATABASE_INDEX_DDL,
  DATABASE_TABLE_DDL,
  REQUIRED_DATABASE_TABLES,
} from '../src/db/schemaInit.ts';
import {
  normalizeRequestKeys,
  toCamelCaseKey,
  toSnakeCaseKey,
  transformKeysToCamelCase,
  transformKeysToSnakeCase,
} from '../src/utils/caseTransformer.ts';

const ROOT_DIR = path.resolve('.');
const SCHEMA_SQL_PATH = path.join(ROOT_DIR, 'schema.sql');
const SCHEMA_SQL = fs.readFileSync(SCHEMA_SQL_PATH, 'utf8');

interface ParsedTable {
  name: string;
  order: number;
  columns: Map<string, string>;
  uniqueColumns: Set<string>;
  foreignKeys: Array<{ column: string; refTable: string; refColumn: string }>;
  constraints: string[];
  rawBody: string;
}

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

function parseSchemaSql(sql: string) {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const enumNames: string[] = [];
  const enumRegex = /CREATE\s+TYPE\s+([a-zA-Z0-9_]+)\s+AS\s+ENUM/gi;
  let enumMatch: RegExpExecArray | null;
  while ((enumMatch = enumRegex.exec(withoutComments)) !== null) {
    enumNames.push(enumMatch[1]);
  }

  const tables = new Map<string, ParsedTable>();
  const tableOrder: string[] = [];
  const tableRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let tableMatch: RegExpExecArray | null;
  let orderCounter = 0;

  while ((tableMatch = tableRegex.exec(withoutComments)) !== null) {
    const tableName = tableMatch[1];
    const body = tableMatch[2];
    const entries = splitTopLevelCommas(body);
    const columns = new Map<string, string>();
    const uniqueColumns = new Set<string>();
    const foreignKeys: Array<{ column: string; refTable: string; refColumn: string }> = [];
    const constraints: string[] = [];

    for (const entry of entries) {
      const constraintMatch = entry.match(/^CONSTRAINT\s+([a-zA-Z0-9_]+)\s+(.+)$/i);
      if (constraintMatch) {
        constraints.push(constraintMatch[1]);
        const uniqueColsMatch = constraintMatch[2].match(/^UNIQUE\s*\(([^)]+)\)/i);
        if (uniqueColsMatch) {
          const cols = uniqueColsMatch[1].split(',').map((c) => c.trim());
          if (cols.length === 1) uniqueColumns.add(cols[0]);
        }
        continue;
      }

      if (/^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(entry)) {
        continue;
      }

      const colMatch = entry.match(/^([a-zA-Z0-9_]+)\s+([\s\S]+)$/);
      assert.ok(colMatch, `Failed to parse column definition in ${tableName}: ${entry}`);
      const colName = colMatch[1];
      const colDef = colMatch[2];
      columns.set(colName, colDef);

      if (/\bPRIMARY\s+KEY\b/i.test(colDef) || /\bUNIQUE\b/i.test(colDef)) {
        uniqueColumns.add(colName);
      }

      const refMatch = colDef.match(/\bREFERENCES\s+([a-zA-Z0-9_]+)\s*\(\s*([a-zA-Z0-9_]+)\s*\)/i);
      if (refMatch) {
        foreignKeys.push({
          column: colName,
          refTable: refMatch[1],
          refColumn: refMatch[2],
        });
      }
    }

    assert.ok(!tables.has(tableName), `Duplicate table definition found in schema.sql: ${tableName}`);
    tables.set(tableName, {
      name: tableName,
      order: orderCounter++,
      columns,
      uniqueColumns,
      foreignKeys,
      constraints,
      rawBody: body,
    });
    tableOrder.push(tableName);
  }

  const indexes: Array<{ name: string; tableName: string; rawExpr: string }> = [];
  const indexRegex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_]+)\s*\(([^;]+?)\)(?:\s+WHERE\s+[^;]+)?\s*;/gi;
  let idxMatch: RegExpExecArray | null;
  while ((idxMatch = indexRegex.exec(withoutComments)) !== null) {
    indexes.push({
      name: idxMatch[1],
      tableName: idxMatch[2],
      rawExpr: idxMatch[3],
    });
  }

  return { enumNames, tables, tableOrder, indexes, withoutComments };
}

test('schema.sql is strictly a fresh standalone schema with zero incremental migrations', () => {
  const withoutComments = SCHEMA_SQL
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const forbiddenDdlPatterns = [
    /\bALTER\s+TABLE\b/i,
    /\bADD\s+COLUMN\b/i,
    /\bMODIFY\s+COLUMN\b/i,
    /\bDROP\s+COLUMN\b/i,
    /\bRENAME\s+COLUMN\b/i,
    /\bALTER\s+COLUMN\b/i,
    /\bALTER\s+TYPE\b/i,
    /\bDROP\s+TABLE\b/i,
    /\bDROP\s+VIEW\b/i,
  ];

  for (const pattern of forbiddenDdlPatterns) {
    assert.equal(
      pattern.test(withoutComments),
      false,
      `Forbidden incremental/destructive DDL pattern matched in schema.sql: ${pattern}`
    );
  }
});

test('schema.sql removes obsolete tables/columns and excludes all size/color product variations', () => {
  const parsed = parseSchemaSql(SCHEMA_SQL);

  const obsoleteTables = [
    'store_requests',
    'deleted_store_requests',
    'customer_khata_ledger',
    'push_subscriptions',
    'app_setting',
    'brands',
    'product_variants',
    'product_sizes',
    'product_colors',
  ];
  for (const oldTable of obsoleteTables) {
    assert.equal(parsed.tables.has(oldTable), false, `Obsolete table should not exist: ${oldTable}`);
  }

  const obsoleteColumns = [
    'low_stock_limit',
    'selling_price',
    'min_selling_quantity',
    'wholesale_price',
    'pricing_policy_locked',
    'invoice_prefix',
    'purchase_prefix',
    'minimum_pairs',
    'store_lot_size',
    'carton_barcode',
    'carton_price',
    'min_order_cartons',
    'shoe_size',
    'variant_id',
    'size',
    'sizes',
    'color',
    'colors',
  ];

  for (const [tableName, table] of parsed.tables.entries()) {
    for (const colName of table.columns.keys()) {
      assert.equal(
        obsoleteColumns.includes(colName),
        false,
        `Obsolete or size/color column "${tableName}.${colName}" must not exist in fresh schema`
      );
      if (colName.includes('color')) {
        assert.equal(
          tableName === 'users' && colName === 'theme_color',
          true,
          `Unexpected color-related column: ${tableName}.${colName}`
        );
      }
    }
  }
});

test('schema.sql enforces snake_case naming, topological foreign keys, and valid unique indexes', () => {
  const parsed = parseSchemaSql(SCHEMA_SQL);
  const snakeCaseRegex = /^[a-z][a-z0-9_]*$/;

  assert.equal(parsed.tables.size, REQUIRED_DATABASE_TABLES.length);
  assert.deepEqual(parsed.tableOrder, [...REQUIRED_DATABASE_TABLES]);

  for (const enumName of parsed.enumNames) {
    assert.match(enumName, snakeCaseRegex, `Enum not snake_case: ${enumName}`);
  }

  for (const [tableName, table] of parsed.tables.entries()) {
    assert.match(tableName, snakeCaseRegex, `Table name not snake_case: ${tableName}`);
    for (const colName of table.columns.keys()) {
      assert.match(colName, snakeCaseRegex, `Column not snake_case: ${tableName}.${colName}`);
    }
    for (const constraintName of table.constraints) {
      assert.match(constraintName, snakeCaseRegex, `Constraint not snake_case: ${constraintName}`);
    }
    for (const fk of table.foreignKeys) {
      const targetTable = parsed.tables.get(fk.refTable);
      assert.ok(targetTable, `Foreign key target missing: ${tableName}.${fk.column} -> ${fk.refTable}`);
      assert.ok(
        targetTable.order < table.order,
        `Topological FK violation: ${tableName} (order ${table.order}) references ${fk.refTable} (order ${targetTable.order})`
      );
      assert.ok(
        targetTable.uniqueColumns.has(fk.refColumn),
        `FK target column must be PK/UNIQUE: ${fk.refTable}.${fk.refColumn}`
      );
    }
  }

  const seenIndexNames = new Set<string>();
  for (const idx of parsed.indexes) {
    assert.match(idx.name, snakeCaseRegex, `Index name not snake_case: ${idx.name}`);
    assert.equal(seenIndexNames.has(idx.name), false, `Duplicate index name: ${idx.name}`);
    seenIndexNames.add(idx.name);
    assert.ok(parsed.tables.has(idx.tableName), `Index ${idx.name} targets unknown table ${idx.tableName}`);
  }
});

test('src/db/schemaInit.ts stays in full parity with schema.sql without runtime ALTER TABLE patches', () => {
  const parsedSchema = parseSchemaSql(SCHEMA_SQL);
  const schemaInitCombined = [...DATABASE_ENUM_DDL, ...DATABASE_TABLE_DDL, ...DATABASE_INDEX_DDL].join(';\n') + ';';
  const parsedInit = parseSchemaSql(schemaInitCombined);

  assert.deepEqual(parsedInit.tableOrder, parsedSchema.tableOrder);
  assert.deepEqual(parsedInit.enumNames, parsedSchema.enumNames);

  for (const tableName of parsedSchema.tableOrder) {
    const schemaCols = Array.from(parsedSchema.tables.get(tableName)!.columns.keys());
    const initCols = Array.from(parsedInit.tables.get(tableName)!.columns.keys());
    assert.deepEqual(initCols, schemaCols, `Column parity mismatch on table ${tableName}`);
  }

  const schemaIdxNames = parsedSchema.indexes.map((i) => i.name).sort();
  const initIdxNames = parsedInit.indexes.map((i) => i.name).sort();
  assert.deepEqual(initIdxNames, schemaIdxNames, 'Index parity mismatch between schema.sql and schemaInit.ts');

  // Verify runtime database/server files contain zero ALTER TABLE/TYPE DDL statements
  const filesToInspect = [
    'src/db/schemaInit.ts',
    'src/server/routes/productRoutes.ts',
    'src/server/routes/customerRoutes.ts',
    'src/server/routes/categoryRoutes.ts',
    'src/server/routes/posRoutes.ts',
    'src/server/routes/tenantSaasRoutes.ts',
    'src/server/services/notificationPreferencesService.ts',
    'server.ts',
  ];

  for (const relPath of filesToInspect) {
    const source = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
    const sourceNoComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(
      /\bALTER\s+(TABLE|TYPE)\b/i.test(sourceNoComments),
      false,
      `Runtime code in ${relPath} must not contain ALTER TABLE or ALTER TYPE`
    );
  }
});

test('caseTransformer supports snake_case canonical keys, camelCase compatibility aliases, and incoming request normalization', () => {
  assert.equal(toSnakeCaseKey('tenantProductNo'), 'tenant_product_no');
  assert.equal(toSnakeCaseKey('RESEND_API_KEY'), 'RESEND_API_KEY');
  assert.equal(toCamelCaseKey('tenant_product_no'), 'tenantProductNo');
  assert.equal(toCamelCaseKey('RESEND_API_KEY'), 'RESEND_API_KEY');

  const snakeOnly = transformKeysToSnakeCase({
    tenantId: 2,
    costPrice: 1200,
    nestedItem: { minPrice: 1500, RESEND_API_KEY: 'abc' },
  });
  assert.deepEqual(snakeOnly, {
    tenant_id: 2,
    cost_price: 1200,
    nested_item: { min_price: 1500, RESEND_API_KEY: 'abc' },
  });

  const apiResponse = transformKeysToCamelCase({
    id: 10,
    tenant_id: 2,
    max_price: 2500,
    total_stock: 14,
  });
  assert.equal(apiResponse.tenant_id, 2);
  assert.equal(apiResponse.tenantId, 2);
  assert.equal(apiResponse.max_price, 2500);
  assert.equal(apiResponse.maxPrice, 2500);
  assert.equal(apiResponse.total_stock, 14);
  assert.equal(apiResponse.totalStock, 14);

  const normalizedReq = normalizeRequestKeys({
    customer_name: 'Ali Footwear',
    totalAmount: 4500,
  });
  assert.equal(normalizedReq.customer_name, 'Ali Footwear');
  assert.equal(normalizedReq.customerName, 'Ali Footwear');
  assert.equal(normalizedReq.total_amount, 4500);
  assert.equal(normalizedReq.totalAmount, 4500);
});
