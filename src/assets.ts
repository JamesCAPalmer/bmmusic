/**
 * The estate's brand assets, served by the Worker.
 *
 * The Minster logo, the app icons and the two type faces the rest of the estate
 * is set in. All bundled as bytes (see the `Data` rule in `wrangler.toml`) and
 * served from `/asset/*`.
 *
 * **Why not a CDN.** `CLAUDE.md` rules out CDN assets, and the reason is in the
 * same sentence: the volunteer portal is used on a phone in a cold song school
 * with one bar of signal. A webfont fetched from `fonts.gstatic.com` is a DNS
 * lookup, a TLS handshake and a round trip to somebody else's server before any
 * text renders in the right face. Same-origin bytes behind a one-year immutable
 * cache cost one download per device, ever.
 *
 * **Why these are the only unauthenticated routes.** The sign-in page needs the
 * logo and the fonts, and it is reached before there is any session. That is not
 * a hole in the gate: a logo and a type face are not catalogue data, and nothing
 * here reveals a single thing about the library. They still carry the noindex
 * header that every other response does.
 */

import CORMORANT from "../assets/cormorant-garamond.woff2";
import OPEN_SANS from "../assets/open-sans.woff2";
import LOGO_LIGHT from "../assets/minster-logo-light.png";
import LOGO_DARK from "../assets/minster-logo-dark.png";
import FAVICON from "../assets/favicon.ico";
import APPLE_TOUCH_ICON from "../assets/apple-touch-icon.png";
import ICON_192 from "../assets/icon-192.png";

interface Asset {
  bytes: ArrayBuffer;
  type: string;
}

/**
 * Every asset, by the name it is served under.
 *
 * The names are stable and versionless because the contents are: a logo and a
 * type face change about once a decade. If one ever does change, the cache
 * header below means a rename is the way to push it out, not a purge.
 */
const ASSETS: Record<string, Asset> = {
  "cormorant-garamond.woff2": { bytes: CORMORANT, type: "font/woff2" },
  "open-sans.woff2": { bytes: OPEN_SANS, type: "font/woff2" },
  "minster-logo-light.png": { bytes: LOGO_LIGHT, type: "image/png" },
  "minster-logo-dark.png": { bytes: LOGO_DARK, type: "image/png" },
  "favicon.ico": { bytes: FAVICON, type: "image/x-icon" },
  "apple-touch-icon.png": { bytes: APPLE_TOUCH_ICON, type: "image/png" },
  "icon-192.png": { bytes: ICON_192, type: "image/png" },
};

export function assetNames(): string[] {
  return Object.keys(ASSETS);
}

/**
 * Serve one asset, or null when the name is not one of ours.
 *
 * `immutable` is the point of the whole arrangement: a browser that has the
 * font does not ask for it again, so the second page load on a phone in the
 * song school fetches nothing but HTML.
 */
export function serveAsset(name: string): Response | null {
  const asset = ASSETS[name];
  if (!asset) return null;

  return new Response(asset.bytes, {
    headers: {
      "content-type": asset.type,
      "cache-control": "public, max-age=31536000, immutable",
      // Public, but still not for indexing.
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
