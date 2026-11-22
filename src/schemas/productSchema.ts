import { z } from 'zod';

/**
 * Zod schema for product price fields. The pricing behavior is supplied from
 * store settings by the caller and is not part of the product payload.
 * Handles conditional "Fixed vs Negotiable" pricing rules:
 *
 * 1. FIXED Price Policy:
 *    - `maxPrice` must be >= `costPrice`
 *    - Automatically normalizes `minPrice = maxPrice`
 *
 * 2. NEGOTIABLE Price Policy:
 *    - Requires `costPrice`, `minPrice` (Min Selling Price), and `maxPrice` (Max Selling Price)
 *    - `minPrice` >= `costPrice`
 *    - `maxPrice` > `minPrice`
 *    - `maxPrice` is the product's negotiable ceiling
 */
export const productPricingSchema = (pricingMode: PricingMode) => z
  .object({
    costPrice: z
      .number({
        message: 'Cost Price is required and must be a valid number.',
      })
      .finite('Cost Price must be a valid number.')
      .min(0, 'Cost Price cannot be negative.'),
    // Legacy request compatibility: new product writes use maxPrice only.
    sellingPrice: z
      .number({
        message: 'Price is required and must be a valid number.',
      })
      .finite('Price must be a valid number.')
      .optional(),
    minPrice: z
      .number({
        message: 'Min Selling Price is required and must be a valid number.',
      })
      .finite('Min Selling Price must be a valid number.')
      .optional(),
    maxPrice: z
      .number({
        message: 'Max Selling Price is required and must be a valid number.',
      })
      .finite('Max Selling Price must be a valid number.')
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (pricingMode === 'FIXED') {
      const fixedPrice = data.maxPrice ?? data.sellingPrice;
      if (fixedPrice === undefined || fixedPrice === null || Number.isNaN(fixedPrice)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxPrice'],
          message: 'Price is required for Fixed Price policy.',
        });
        return;
      }

      if (fixedPrice <= 0 && data.costPrice > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxPrice'],
          message: 'Selling Price must be greater than zero.',
        });
      }

      if (fixedPrice < data.costPrice) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxPrice'],
          message: `Maximum Price (${fixedPrice}) must be greater than or equal to Cost Price (${data.costPrice}).`,
        });
      }
    } else if (pricingMode === 'NEGOTIABLE') {
      const hasMin = data.minPrice !== undefined && data.minPrice !== null && !Number.isNaN(data.minPrice);
      const hasMax = data.maxPrice !== undefined && data.maxPrice !== null && !Number.isNaN(data.maxPrice);

      if (!hasMin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['minPrice'],
          message: 'Minimum Selling Price is required for Negotiable Price policy.',
        });
      }

      if (!hasMax) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxPrice'],
          message: 'Maximum Selling Price is required for Negotiable Price policy.',
        });
      }

      if (hasMin && data.minPrice! < data.costPrice) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['minPrice'],
          message: `Minimum Selling Price (${data.minPrice}) must be greater than or equal to Cost Price (${data.costPrice}).`,
        });
      }

      if (hasMin && hasMax && Math.round(data.maxPrice!) <= Math.round(data.minPrice!)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxPrice'],
          message: `Tag Price (${data.maxPrice}) must be greater than Minimum Selling Price (${data.minPrice}) for negotiable pricing.`,
        });
      }
    }
  })
  .transform((data) => {
    const costPrice = Math.round(data.costPrice);
    if (pricingMode === 'FIXED') {
      const price = Math.round(data.maxPrice ?? data.sellingPrice!);
      // Fixed Price Policy Rule: minPrice = maxPrice
      return {
        costPrice,
        sellingPrice: price,
        minPrice: price,
        maxPrice: price,
      };
    } else {
      const minPrice = Math.round(data.minPrice!);
      const maxPrice = Math.round(data.maxPrice!);
      // Negotiable Price Policy Rule: sellingPrice defaults to maxPrice (tag price)
      return {
        costPrice,
        sellingPrice: maxPrice,
        minPrice,
        maxPrice,
      };
    }
  });

export type PricingMode = 'FIXED' | 'NEGOTIABLE';
export type ValidatedProductPricing = z.output<ReturnType<typeof productPricingSchema>>;

/**
 * Helper to validate and normalize product pricing with field-level and summary errors.
 */
export function validateAndNormalizeProductPricing(input: {
  pricingMode: PricingMode;
  costPrice: number | string | undefined | null;
  sellingPrice?: number | string | undefined | null;
  minPrice?: number | string | undefined | null;
  maxPrice?: number | string | undefined | null;
}): {
  success: boolean;
  data?: ValidatedProductPricing;
  error?: string;
  fieldErrors: {
    costPrice?: string;
    sellingPrice?: string;
    minPrice?: string;
    maxPrice?: string;
    general?: string;
  };
  errors: {
    costPrice?: string;
    sellingPrice?: string;
    minPrice?: string;
    maxPrice?: string;
    general?: string;
  };
} {
  const parseNum = (val: number | string | undefined | null): number | undefined => {
    if (val === undefined || val === null || String(val).trim() === '') return undefined;
    const n = Number(val);
    return Number.isFinite(n) ? n : NaN;
  };

  const rawCost = parseNum(input.costPrice);
  const rawSelling = parseNum(input.sellingPrice);
  const rawMin = parseNum(input.minPrice);
  const rawMax = parseNum(input.maxPrice);

  const result = productPricingSchema(input.pricingMode).safeParse({
    costPrice: rawCost,
    sellingPrice: rawSelling,
    minPrice: rawMin,
    maxPrice: rawMax,
  });

  if (result.success) {
    return {
      success: true,
      data: result.data,
      fieldErrors: {},
      errors: {},
    };
  }

  const errors: {
    costPrice?: string;
    sellingPrice?: string;
    minPrice?: string;
    maxPrice?: string;
    general?: string;
  } = {};

  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof typeof errors | undefined;
    if (field && !errors[field]) {
      errors[field] = issue.message;
    }
    if (!errors.general) {
      errors.general = issue.message;
    }
  }

  return {
    success: false,
    error: errors.general || 'Invalid product pricing.',
    fieldErrors: errors,
    errors,
  };
}

/**
 * Zod Schema for Product Brand validation.
 * Brand is validated and stored as a plain text string rather than a relational ID.
 */
export const productBrandSchema = z
  .string({
    message: 'Brand must be a text string.',
  })
  .trim()
  .max(100, 'Brand name cannot exceed 100 characters.')
  .transform((brand) => brand || 'Unbranded');

export function validateProductBrand(brand: unknown): {
  success: boolean;
  brand: string;
  error?: string;
} {
  const result = productBrandSchema.safeParse(brand);
  if (result.success) {
    return { success: true, brand: result.data };
  }
  return {
    success: false,
    brand: typeof brand === 'string' && brand.trim() ? brand.trim() : 'Unbranded',
    error: result.error.issues[0]?.message || 'Invalid brand text.',
  };
}

/**
 * Normalizes and validates pairs per carton value (must be 12 or 16).
 */
export function normalizePairsPerCarton(value: unknown): 12 | 16 {
  const num = Number(value);
  return num === 16 ? 16 : 12;
}

/**
 * Determination: Product-level allow_half_carton takes precedence as an explicit override.
 * - If product explicitly specifies allowHalfCarton (true or false), that rule is enforced.
 *   (e.g., if a wholesale store globally allows half cartons, but a specific product has allowHalfCarton = false,
 *    that product is strictly Full Carton only).
 * - If product does not specify (undefined or null), it inherits the store default (storeSetting.allow_half_carton).
 */
export function isHalfCartonAllowed(
  product?: { allowHalfCarton?: boolean; allow_half_carton?: boolean } | null,
  storeSetting?: { allowHalfCarton?: boolean; allow_half_carton?: boolean } | null
): boolean {
  const productVal = product?.allowHalfCarton ?? product?.allow_half_carton;
  if (typeof productVal === 'boolean') {
    return productVal;
  }
  return storeSetting?.allowHalfCarton === true || storeSetting?.allow_half_carton === true;
}

/**
 * Dynamic minimum sale quantity calculation:
 * - For Retailer: min_sale_quantity = 1 pair
 * - For Wholesaler:
 *     If half-cartons are allowed: min_sale_quantity = pairs_per_carton / 2
 *     Otherwise (full carton only): min_sale_quantity = pairs_per_carton
 */
export function calculateMinSaleQuantity(
  product?: { pairsPerCarton?: number; pairs_per_carton?: number; allowHalfCarton?: boolean; allow_half_carton?: boolean } | null,
  storeSetting?: { allowHalfCarton?: boolean; allow_half_carton?: boolean; businessType?: string; business_type?: string } | null
): number {
  const businessType = String((storeSetting as any)?.businessType || (storeSetting as any)?.business_type || '').toUpperCase();
  const isWholesale = businessType === 'WHOLESALE';

  // Retail stores always sell by individual pairs (min 1 pair)
  if (storeSetting && (businessType === 'RETAIL' || (!isWholesale && businessType.length > 0))) {
    return 1;
  }

  const rawPairs = Number(product?.pairsPerCarton ?? product?.pairs_per_carton ?? 12);
  const pairsPerCtn = rawPairs === 16 ? 16 : 12;
  const halfAllowed = isHalfCartonAllowed(product, storeSetting);
  return halfAllowed ? (pairsPerCtn / 2) : pairsPerCtn;
}

const STOCK_DECIMAL_SCALE = 10000;
const STRICT_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function toScaledDecimal(value: unknown): {
  ok: boolean;
  value: number;
  scaled: number;
} {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { ok: false, value: NaN, scaled: NaN };
    const scaled = Math.round(value * STOCK_DECIMAL_SCALE);
    const snapped = scaled / STOCK_DECIMAL_SCALE;
    if (Math.abs(value - snapped) > 1e-9) {
      return { ok: false, value: NaN, scaled: NaN };
    }
    return { ok: true, value: Object.is(snapped, -0) ? 0 : snapped, scaled: scaled === 0 ? 0 : scaled };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !STRICT_NUMBER_PATTERN.test(trimmed)) {
      return { ok: false, value: NaN, scaled: NaN };
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return { ok: false, value: NaN, scaled: NaN };
    }
    const scaled = Math.round(parsed * STOCK_DECIMAL_SCALE);
    const snapped = scaled / STOCK_DECIMAL_SCALE;
    if (Math.abs(parsed - snapped) > 1e-9) {
      return { ok: false, value: NaN, scaled: NaN };
    }
    return { ok: true, value: Object.is(snapped, -0) ? 0 : snapped, scaled: scaled === 0 ? 0 : scaled };
  }

  return { ok: false, value: NaN, scaled: NaN };
}

function formatCleanStockNumber(val: number): string {
  const scaled = Math.round(val * STOCK_DECIMAL_SCALE) / STOCK_DECIMAL_SCALE;
  return Number.isInteger(scaled) ? String(scaled) : String(scaled);
}

/**
 * Precision-safe conversion from pairs to cartons without IEEE-754 floating-point drift.
 */
export function calculateCartonsFromPairs(pairs: number, pairsPerCarton: number = 12): number {
  const parsedPairs = toScaledDecimal(pairs);
  const parsedPpc = toScaledDecimal(pairsPerCarton);
  if (!parsedPairs.ok || !parsedPpc.ok || parsedPpc.scaled <= 0) return 0;
  return Math.round((parsedPairs.scaled / parsedPpc.scaled) * STOCK_DECIMAL_SCALE) / STOCK_DECIMAL_SCALE;
}

/**
 * Precision-safe conversion from cartons to pairs without IEEE-754 floating-point drift.
 */
export function convertCartonsToPairs(cartons: number, pairsPerCarton: number = 12): number {
  const parsedCartons = toScaledDecimal(cartons);
  const parsedPpc = toScaledDecimal(pairsPerCarton);
  if (!parsedCartons.ok || !parsedPpc.ok || parsedPpc.scaled <= 0) return 0;
  return Math.round((parsedCartons.scaled * parsedPpc.scaled) / STOCK_DECIMAL_SCALE) / STOCK_DECIMAL_SCALE;
}

/**
 * Returns the minimum allowed pair increment for wholesale stock entry/updates:
 * - If half carton (0.5) is allowed: pairs_per_carton / 2
 * - Otherwise (full carton only): pairs_per_carton
 */
export function getWholesaleStockStep(
  product?: { pairsPerCarton?: number; pairs_per_carton?: number; allowHalfCarton?: boolean; allow_half_carton?: boolean } | null,
  storeSetting?: { allowHalfCarton?: boolean; allow_half_carton?: boolean } | null
): number {
  const rawPpc = toScaledDecimal(product?.pairsPerCarton ?? product?.pairs_per_carton ?? 12);
  const ppcScaled = rawPpc.ok && rawPpc.scaled > 0 ? rawPpc.scaled : 12 * STOCK_DECIMAL_SCALE;
  const allowHalf = isHalfCartonAllowed(product, storeSetting);
  const stepScaled = allowHalf ? Math.round(ppcScaled / 2) : ppcScaled;
  return stepScaled / STOCK_DECIMAL_SCALE;
}

export interface WholesaleStockValidationInput {
  quantity: unknown;
  pairsPerCarton?: number | string | null;
  allowHalfCarton: boolean;
  isWholesaleStore: boolean;
}

export interface WholesaleStockValidationResult {
  valid: boolean;
  normalizedQuantity: number | null;
  pairsPerCarton: number;
  allowedIncrement: number;
  cartons: number | null;
  error?: string;
}

/**
 * Validates B2B (Wholesale) stock quantity against `pairs_per_carton` divisibility rules.
 * - Strictly skipped for B2C (Retail) stores so retail workflows remain unaffected.
 * - When fractional cartons are NOT allowed: accepts only quantities divisible by `pairs_per_carton`.
 * - When "0.5" carton IS allowed: accepts only quantities divisible by `pairs_per_carton / 2`.
 * - Uses scaled integer arithmetic to avoid floating-point precision issues.
 */
export function validateWholesaleStockQuantity(
  input: WholesaleStockValidationInput
): WholesaleStockValidationResult {
  const rawPpc = toScaledDecimal(input.pairsPerCarton ?? 12);
  const ppcScaled = rawPpc.ok && rawPpc.scaled > 0 ? rawPpc.scaled : 12 * STOCK_DECIMAL_SCALE;
  const pairsPerCarton = ppcScaled / STOCK_DECIMAL_SCALE;

  if (!input.isWholesaleStore) {
    const parsed = toScaledDecimal(input.quantity ?? 0);
    if (!parsed.ok || parsed.scaled < 0) {
      return {
        valid: false,
        normalizedQuantity: null,
        pairsPerCarton,
        allowedIncrement: 1,
        cartons: null,
        error: 'Stock quantity must be 0 or more.',
      };
    }
    const retailQty = Math.trunc(parsed.value);
    return {
      valid: true,
      normalizedQuantity: retailQty,
      pairsPerCarton,
      allowedIncrement: 1,
      cartons: null,
    };
  }

  const allowHalf = Boolean(input.allowHalfCarton);
  const stepScaled = allowHalf ? Math.round(ppcScaled / 2) : ppcScaled;
  const allowedIncrement = stepScaled / STOCK_DECIMAL_SCALE;
  const stepStr = formatCleanStockNumber(allowedIncrement);
  const ppcStr = formatCleanStockNumber(pairsPerCarton);
  const ex1 = formatCleanStockNumber(allowedIncrement);
  const ex2 = formatCleanStockNumber((stepScaled * 2) / STOCK_DECIMAL_SCALE);
  const ex3 = formatCleanStockNumber((stepScaled * 3) / STOCK_DECIMAL_SCALE);
  const ruleContext = allowHalf
    ? `0.5 carton of ${ppcStr} pairs/carton`
    : `full carton of ${ppcStr} pairs/carton`;

  if (
    input.quantity === undefined ||
    input.quantity === null ||
    (typeof input.quantity === 'string' && input.quantity.trim() === '')
  ) {
    return {
      valid: false,
      normalizedQuantity: null,
      pairsPerCarton,
      allowedIncrement,
      cartons: null,
      error: `Stock quantity is required. Enter a multiple of ${stepStr} pairs (${ruleContext}).`,
    };
  }

  const parsed = toScaledDecimal(input.quantity);
  if (!parsed.ok) {
    return {
      valid: false,
      normalizedQuantity: null,
      pairsPerCarton,
      allowedIncrement,
      cartons: null,
      error: `Invalid stock quantity. Enter a valid quantity divisible by ${stepStr} pairs (${ruleContext}, e.g. ${ex1}, ${ex2}, ${ex3}).`,
    };
  }

  if (parsed.scaled < 0) {
    return {
      valid: false,
      normalizedQuantity: null,
      pairsPerCarton,
      allowedIncrement,
      cartons: null,
      error: `Stock quantity cannot be negative. Enter a multiple of ${stepStr} pairs (${ruleContext}).`,
    };
  }

  if (parsed.scaled % stepScaled !== 0) {
    const qtyDisplay = formatCleanStockNumber(parsed.value);
    const halfRuleText = allowHalf
      ? `Half cartons (0.5) are allowed, so stock must be divisible by ${stepStr} pairs`
      : `Half cartons (0.5) are not allowed, so stock must be divisible by ${stepStr} pairs`;
    return {
      valid: false,
      normalizedQuantity: null,
      pairsPerCarton,
      allowedIncrement,
      cartons: null,
      error: `Invalid stock quantity (${qtyDisplay} pairs). ${halfRuleText} (${ruleContext}, e.g. ${ex1}, ${ex2}, ${ex3}).`,
    };
  }

  const cartons = Math.round((parsed.scaled / ppcScaled) * STOCK_DECIMAL_SCALE) / STOCK_DECIMAL_SCALE;

  return {
    valid: true,
    normalizedQuantity: parsed.value,
    pairsPerCarton,
    allowedIncrement,
    cartons,
  };
}
