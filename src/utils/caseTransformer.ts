/**
 * Universal Case Transformer & Response Normalizer
 * Ensures consistent snake_case keys across database rows, backend API payloads,
 * and frontend consumers while preserving camelCase aliases for UI compatibility.
 */

function isPlainObject(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))
  ) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function shouldPreserveKeyAsIs(key: string): boolean {
  if (!key) return true;
  // Preserve ALL_CAPS settings/constant keys (e.g., RESEND_API_KEY, PKR) and special keys (URLs, CSS selectors, etc.)
  if (/^[A-Z0-9_]+$/.test(key)) return true;
  if (/[.\-/\s:]/.test(key)) return true;
  return false;
}

export function toSnakeCaseKey(key: string): string {
  if (shouldPreserveKeyAsIs(key)) return key;
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function toCamelCaseKey(key: string): string {
  if (shouldPreserveKeyAsIs(key) || !key.includes('_')) return key;
  return key.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

/**
 * Recursively converts all object keys into canonical snake_case.
 */
export function transformKeysToSnakeCase<T = any>(data: any): T {
  if (data === null || data === undefined || typeof data !== 'object') {
    return data as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => transformKeysToSnakeCase(item)) as unknown as T;
  }

  if (!isPlainObject(data)) {
    return data as unknown as T;
  }

  const result: Record<string, any> = {};
  for (const [rawKey, rawValue] of Object.entries(data)) {
    const snakeKey = toSnakeCaseKey(rawKey);
    const transformedValue = transformKeysToSnakeCase(rawValue);
    if (!(snakeKey in result) || rawKey === snakeKey) {
      result[snakeKey] = transformedValue;
    }
  }
  return result as T;
}

/**
 * Normalizes an object or array recursively so every property is available in
 * canonical snake_case AND camelCase (preserving backward compatibility across UI & tests).
 * Automatically unifies company settings aliases (company_name/name, tax_id/tax_number).
 */
export function transformKeysToCamelCase<T = any>(data: any): T {
  if (data === null || data === undefined || typeof data !== 'object') {
    return data as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => transformKeysToCamelCase(item)) as unknown as T;
  }

  if (!isPlainObject(data)) {
    return data as unknown as T;
  }

  const result: Record<string, any> = {};

  for (const [rawKey, rawValue] of Object.entries(data)) {
    const snakeKey = toSnakeCaseKey(rawKey);
    const camelKey = toCamelCaseKey(rawKey);
    const transformedValue = transformKeysToCamelCase(rawValue);

    // Emit canonical snake_case key
    if (!(snakeKey in result) || rawKey === snakeKey) {
      result[snakeKey] = transformedValue;
    }

    // Emit camelCase alias when different
    if (camelKey !== snakeKey && (!(camelKey in result) || rawKey === camelKey)) {
      result[camelKey] = transformedValue;
    }

    // Preserve exact original key if neither matches
    if (rawKey !== snakeKey && rawKey !== camelKey && !(rawKey in result)) {
      result[rawKey] = transformedValue;
    }
  }

  // Unify Company Settings aliases cleanly across both cases
  if (result.company_name !== undefined && result.name === undefined) {
    result.name = result.company_name;
  } else if (result.name !== undefined && result.company_name === undefined) {
    result.company_name = result.name;
    result.companyName = result.name;
  }

  if (result.companyName !== undefined && result.name === undefined) {
    result.name = result.companyName;
  } else if (result.name !== undefined && result.companyName === undefined) {
    result.companyName = result.name;
  }

  if (result.tax_number !== undefined && result.tax_id === undefined) {
    result.tax_id = result.tax_number;
    result.taxId = result.tax_number;
  } else if (result.tax_id !== undefined && result.tax_number === undefined) {
    result.tax_number = result.tax_id;
    result.taxNumber = result.tax_id;
  }

  if (result.taxNumber !== undefined && result.taxId === undefined) {
    result.taxId = result.taxNumber;
  } else if (result.taxId !== undefined && result.taxNumber === undefined) {
    result.taxNumber = result.taxId;
  }

  return result as T;
}

/**
 * Normalizes incoming API request objects (req.body / req.query) so routes accept
 * both snake_case and camelCase payloads seamlessly.
 */
export function normalizeRequestKeys<T = any>(data: any): T {
  if (data === null || data === undefined || typeof data !== 'object') {
    return data as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => normalizeRequestKeys(item)) as unknown as T;
  }

  if (!isPlainObject(data)) {
    return data as unknown as T;
  }

  const result: Record<string, any> = {};
  for (const [rawKey, rawValue] of Object.entries(data)) {
    const snakeKey = toSnakeCaseKey(rawKey);
    const camelKey = toCamelCaseKey(rawKey);
    const normalizedValue = normalizeRequestKeys(rawValue);

    result[rawKey] = normalizedValue;
    if (snakeKey !== rawKey && !(snakeKey in result)) {
      result[snakeKey] = normalizedValue;
    }
    if (camelKey !== rawKey && !(camelKey in result)) {
      result[camelKey] = normalizedValue;
    }
  }
  return result as T;
}
