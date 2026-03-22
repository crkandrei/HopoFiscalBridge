import { z } from 'zod';
import logger from './logger';

/**
 * Payment type enum - only CASH and CARD are supported
 */
export enum PaymentType {
  CASH = 'CASH',
  CARD = 'CARD',
}

/**
 * Schema for a single receipt item
 */
export const receiptItemSchema = z.object({
  name: z.string().min(1, 'Item name is required and cannot be empty'),
  quantity: z.number().positive('Quantity must be a positive number').default(1),
  price: z
    .number()
    .positive('Price must be a positive number')
    .finite('Price must be a finite number'),
  vatClass: z.number().int().min(1).max(9).optional(),
});

/**
 * Schema for validating print request input
 * Supports both legacy format (productName/duration/price) and new format (items array)
 */
export const printRequestSchema = z.object({
  // Legacy fields (optional if items is provided)
  productName: z
    .string()
    .min(1, 'Product name is required if items is not provided')
    .optional(),
  duration: z.string().min(1, 'Duration is required if items is not provided').optional(),
  price: z
    .number()
    .positive('Price must be a positive number')
    .finite('Price must be a finite number')
    .optional(),
  // New format: array of items
  items: z.array(receiptItemSchema).min(1, 'At least one item is required').optional(),
  paymentType: z.nativeEnum(PaymentType, {
    errorMap: () => ({
      message: 'Payment type must be either CASH or CARD',
    }),
  }),
  // Voucher hours (optional)
  voucherHours: z.number().min(0, 'Voucher hours must be non-negative').optional(),
}).refine(
  (data) => {
    // Either items array OR legacy productName/duration/price must be provided
    return (data.items && data.items.length > 0) || 
           (data.productName && data.duration !== undefined && data.price !== undefined);
  },
  {
    message: 'Either items array or productName/duration/price must be provided',
  }
);

/**
 * Type inference from Zod schema
 */
export type PrintRequest = z.infer<typeof printRequestSchema>;

/**
 * Validates print request data
 * @param data - The data to validate
 * @returns Object with success flag and either validated data or error message
 */
export function validatePrintRequest(data: unknown): {
  success: boolean;
  data?: PrintRequest;
  error?: string;
} {
  try {
    const validatedData = printRequestSchema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      logger.warn('Validation error', { error: errorMessage, data });
      return { success: false, error: errorMessage };
    }
    logger.error('Unexpected validation error', { error });
    return { success: false, error: 'Invalid request data' };
  }
}

