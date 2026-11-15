import { flagSprite } from "../../lib/flagSprite.tsx";

/** Built with the site and served as a static file: no function runs for it (see src/lib/flagSprite.tsx). */
export const dynamic = "force-static";

/** Every flag, for the footer's <use> references; its address carries a version, so it can be kept for a year. */
export function GET() {
  return new Response(flagSprite(), {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
