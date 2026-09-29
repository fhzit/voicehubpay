import { z } from "zod";

export const healthResponseSchema = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export const moneyCentsSchema = z.number().int().nonnegative();
export const paymentStatusSchema = z.enum(["unpaid", "pending", "paid", "failed"]);

export const authLoginRequestSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(1024) }).strict();
export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>;
export const authLoginResponseSchema = z.object({ csrfToken: z.string().min(32) });
export const authLoginFailureSchema = z.object({ error: z.literal("INVALID_CREDENTIALS"), message: z.string() });
export const authNotConfiguredSchema = z.object({ error: z.literal("AUTH_NOT_CONFIGURED"), message: z.string() });
export const authMeResponseSchema = z.object({ error: z.literal("UNAUTHENTICATED"), message: z.string() });
export const authRotateResponseSchema = z.object({ status: z.literal("rotated"), csrfToken: z.string().min(32) });
export const apiErrorSchema = z.object({ error: z.string(), message: z.string(), requestId: z.string() });
