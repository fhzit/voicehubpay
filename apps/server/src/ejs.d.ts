/**
 * Minimal ambient types for the `ejs` package (v7 ships no bundled typings and
 * the repo must not add a new dependency). Only the API used by render.ts is
 * declared, so templates stay type-checked at the call site.
 */
declare module "ejs" {
  export interface RenderFileOptions {
    /** Enable async template rendering (await inside templates). */
    async?: boolean;
    [key: string]: unknown;
  }

  export function renderFile(
    path: string,
    data: Record<string, unknown>,
    options?: RenderFileOptions,
  ): Promise<string>;

  const ejs: { renderFile: typeof renderFile };
  export default ejs;
}
