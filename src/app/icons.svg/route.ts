import { iconSprite } from "../../components/Icon.tsx";

/** Built with the site and served as a static file: no function runs for it (see iconSprite in src/components/Icon.tsx). */
export const dynamic = "force-static";

/** Every Lucide icon the site draws, for <Icon>'s <use> references; its address carries a version, so it can be kept for a year. */
export function GET() {
  return new Response(iconSprite(), {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
