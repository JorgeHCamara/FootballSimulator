import { createHash } from "node:crypto";
import type { ReactElement, ReactNode } from "react";
import { FLAG_CODES, shapes } from "../components/Flag.tsx";

/*
 * Every flag in one SVG file (/flags.svg, src/app/flags.svg/route.ts), each a
 * group by its code, drawn from the same shapes as <Flag>. The footer lists
 * every competition on every page: its fifty flags inline were about a third
 * of a light page's payload (the HTML and, again, the RSC data), on every
 * regeneration and cache miss. Referenced with <use> instead (FooterFlag in
 * src/components/SiteFooter.tsx), they're one small file the browser and the
 * CDN keep, and the footer looks the same.
 */

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
/** React's SVG prop names as attributes (strokeWidth → stroke-width). */
const attribute = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** SVG markup of plain elements (a flag's shapes): intrinsic elements, fragments and text only. */
export function svgMarkup(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(svgMarkup).join("");
  if (typeof node === "string" || typeof node === "number") return escape(String(node));
  const element = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  const { children, ...props } = element.props;
  if (typeof element.type !== "string") return svgMarkup(children);
  const attrs = Object.entries(props)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => ` ${attribute(name)}="${escape(String(value))}"`)
    .join("");
  return `<${element.type}${attrs}>${svgMarkup(children)}</${element.type}>`;
}

let sprite: string | undefined;

/** The sprite: each flag's shapes in a group whose id is its code. */
export function flagSprite(): string {
  sprite ??= `<svg xmlns="http://www.w3.org/2000/svg">${FLAG_CODES.map((code) => `<g id="${code}">${svgMarkup(shapes(code))}</g>`).join("")}</svg>`;
  return sprite;
}

let url: string | undefined;

/** The sprite's address, versioned by its contents: a changed flag is a new address, so browsers can keep it for a year. */
export function flagSpriteUrl(): string {
  url ??= `/flags.svg?v=${createHash("sha256").update(flagSprite()).digest("hex").slice(0, 10)}`;
  return url;
}
