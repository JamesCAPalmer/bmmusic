/**
 * The committed draft index is bundled with the Worker as text (see the
 * `[[rules]]` block in wrangler.toml), so the admin import action can read it
 * without an upload step.
 */
declare module "*.csv" {
  const content: string;
  export default content;
}
