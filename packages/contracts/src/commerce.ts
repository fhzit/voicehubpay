import { z } from "zod";

export const productQuerySchema = z.object({}).strict();
export const productIdParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
export const productResponseSchema = z.object({ id: z.union([z.number().int().positive(), z.string().min(1)]), name: z.string(), slug: z.string(), description: z.string(), priceCents: z.number().int().nonnegative(), status: z.enum(["draft", "active", "archived"]) });
export const productListResponseSchema = z.object({ products: z.array(productResponseSchema) });
export const createProductRequestSchema = z.object({ name: z.string().trim().min(1).max(255), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/), description: z.string().max(10000).optional(), priceCents: z.number().int().min(0).max(2147483647), status: z.enum(["draft", "active", "archived"]).optional() }).strict();
export const orderStatusResponseSchema = z.object({ id: z.number().int().positive(), orderNo: z.string(), orderStatus: z.string(), paymentStatus: z.enum(["unpaid", "pending", "paid", "failed"]), fulfillmentStatus: z.string(), amountDueCents: z.number().int().nonnegative(), amountPaidCents: z.number().int().nonnegative(), createdAt: z.string() });
export const createOrderRequestSchema = z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive().max(100) }).strict();
export type ProductResponse = z.infer<typeof productResponseSchema>;
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;
export type OrderStatusResponse = z.infer<typeof orderStatusResponseSchema>;
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
