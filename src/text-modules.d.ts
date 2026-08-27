/**
 * The committed draft index is bundled with the Worker as text (see the
 * `[[rules]]` block in wrangler.toml), so the admin import action can read it
 * without an upload step.
 */
declare module "*.csv" {
  const content: string;
  export default content;
}

/**
 * The estate's brand assets — the Minster logo, the app icons and the two type
 * faces — are bundled as raw bytes by the `Data` rule in wrangler.toml and
 * served from `/asset/*` by `src/assets.ts`, so that nothing is fetched from a
 * CDN. Each import is an ArrayBuffer.
 */
declare module "*.woff2" {
  const content: ArrayBuffer;
  export default content;
}

declare module "*.png" {
  const content: ArrayBuffer;
  export default content;
}

declare module "*.ico" {
  const content: ArrayBuffer;
  export default content;
}
