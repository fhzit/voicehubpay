import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  WEB_ORIGIN: z.string().url(),
});

export type ServerConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  webOrigin: string;
}>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.WEB_ORIGIN.startsWith("http://")) {
    throw new Error("Invalid server configuration: WEB_ORIGIN must use HTTPS in production");
  }
  return Object.freeze({ nodeEnv: parsed.data.NODE_ENV, port: parsed.data.PORT, host: parsed.data.HOST, webOrigin: parsed.data.WEB_ORIGIN });
}
