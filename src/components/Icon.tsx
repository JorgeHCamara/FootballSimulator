// Icons from Lucide (https://lucide.dev), copied as SVG data (the npm package
// isn't needed for this handful). Lucide is under the ISC License:
//   ISC License
//
//   Copyright (c) 2026 Lucide Icons and Contributors
//
//   Permission to use, copy, modify, and/or distribute this software for any
//   purpose with or without fee is hereby granted, provided that the above
//   copyright notice and this permission notice appear in all copies.
//
//   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
//   WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
//   MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
//   ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
//   WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
//   ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
//   OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
//
//   ---
//
//   The following Lucide icons are derived from the Feather project:
//
//   airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
//
//   The MIT License (MIT) (for the icons listed above)
//
//   Copyright (c) 2013-present Cole Bemis
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.

import type { SVGProps } from "react";

type IconNode = readonly (readonly [string, Readonly<Record<string, string>>])[];

const ICONS = {
  "arrow-down": [["path", {"d": "M12 5v14"}], ["path", {"d": "m19 12-7 7-7-7"}]],
  "arrow-right": [["path", {"d": "M5 12h14"}], ["path", {"d": "m12 5 7 7-7 7"}]],
  "arrow-up": [["path", {"d": "m5 12 7-7 7 7"}], ["path", {"d": "M12 19V5"}]],
  "calendar-days": [["path", {"d": "M8 2v3"}], ["path", {"d": "M16 2v3"}], ["rect", {"x": "3", "y": "3", "width": "18", "height": "18", "rx": "2"}], ["path", {"d": "M3 9h18"}], ["path", {"d": "M8 13h.01"}], ["path", {"d": "M12 13h.01"}], ["path", {"d": "M16 13h.01"}], ["path", {"d": "M8 17h.01"}], ["path", {"d": "M12 17h.01"}], ["path", {"d": "M16 17h.01"}]],
  "chart-column": [["path", {"d": "M3 3v16a2 2 0 0 0 2 2h16"}], ["path", {"d": "M18 17V9"}], ["path", {"d": "M13 17V5"}], ["path", {"d": "M8 17v-3"}]],
  "check": [["path", {"d": "M20 6 9 17l-5-5"}]],
  "chevron-down": [["path", {"d": "m6 9 6 6 6-6"}]],
  "chevron-left": [["path", {"d": "m15 18-6-6 6-6"}]],
  "chevron-right": [["path", {"d": "m9 18 6-6-6-6"}]],
  "clock": [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "M12 6v6l4 2"}]],
  "dices": [["rect", {"width": "12", "height": "12", "x": "2", "y": "10", "rx": "2", "ry": "2"}], ["path", {"d": "m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"}], ["path", {"d": "M6 18h.01"}], ["path", {"d": "M10 14h.01"}], ["path", {"d": "M15 6h.01"}], ["path", {"d": "M18 9h.01"}]],
  "download": [["path", {"d": "M12 15V3"}], ["path", {"d": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}], ["path", {"d": "m7 10 5 5 5-5"}]],
  "ellipsis": [["circle", {"cx": "12", "cy": "12", "r": "1"}], ["circle", {"cx": "19", "cy": "12", "r": "1"}], ["circle", {"cx": "5", "cy": "12", "r": "1"}]],
  "house": [["path", {"d": "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"}], ["path", {"d": "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}]],
  "image": [["rect", {"width": "18", "height": "18", "x": "3", "y": "3", "rx": "2", "ry": "2"}], ["circle", {"cx": "9", "cy": "9", "r": "2"}], ["path", {"d": "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}]],
  "info": [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "M12 16v-4"}], ["path", {"d": "M12 8h.01"}]],
  "link": [["path", {"d": "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"}], ["path", {"d": "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"}]],
  "loader-circle": [["path", {"d": "M21 12a9 9 0 1 1-6.219-8.56"}]],
  "map-pin": [["path", {"d": "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}], ["circle", {"cx": "12", "cy": "10", "r": "3"}]],
  "menu": [["path", {"d": "M4 5h16"}], ["path", {"d": "M4 12h16"}], ["path", {"d": "M4 19h16"}]],
  "message-circle": [["path", {"d": "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}]],
  "messages-square": [["path", {"d": "M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"}], ["path", {"d": "M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"}]],
  "minus": [["path", {"d": "M5 12h14"}]],
  "plane": [["path", {"d": "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"}]],
  "rotate-ccw": [["path", {"d": "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}], ["path", {"d": "M3 3v5h5"}]],
  "send": [["path", {"d": "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"}], ["path", {"d": "m21.854 2.147-10.94 10.939"}]],
  "share": [["path", {"d": "M12 2v13"}], ["path", {"d": "m16 6-4-4-4 4"}], ["path", {"d": "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"}]],
  "share-2": [["circle", {"cx": "18", "cy": "5", "r": "3"}], ["circle", {"cx": "6", "cy": "12", "r": "3"}], ["circle", {"cx": "18", "cy": "19", "r": "3"}], ["line", {"x1": "8.59", "x2": "15.42", "y1": "13.51", "y2": "17.49"}], ["line", {"x1": "15.41", "x2": "8.59", "y1": "6.51", "y2": "10.49"}]],
  "target": [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["circle", {"cx": "12", "cy": "12", "r": "6"}], ["circle", {"cx": "12", "cy": "12", "r": "2"}]],
  "thumbs-up": [["path", {"d": "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"}], ["path", {"d": "M7 10v12"}]],
  "trending-down": [["path", {"d": "M16 17h6v-6"}], ["path", {"d": "m22 17-8.5-8.5-5 5L2 7"}]],
  "trending-up": [["path", {"d": "M16 7h6v6"}], ["path", {"d": "m22 7-8.5 8.5-5-5L2 17"}]],
  "trophy": [["path", {"d": "M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"}], ["path", {"d": "M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"}], ["path", {"d": "M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"}], ["path", {"d": "M4 22h16"}], ["path", {"d": "M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"}], ["path", {"d": "M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"}]],
  "x": [["path", {"d": "M18 6 6 18"}], ["path", {"d": "m6 6 12 12"}]],
} as const satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

/**
 * A Lucide icon: 24×24, drawn with the current text colour. Decorative
 * (aria-hidden) unless given a `title`.
 */
export function Icon({ name, size = 18, strokeWidth = 2, title, ...props }: { name: IconName; size?: number; strokeWidth?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      focusable="false"
      data-icon={name}
      {...props}
    >
      {title && <title>{title}</title>}
      {(ICONS[name] as IconNode).map(([tag, attrs], i) => {
        const Tag = tag as "path";
        return <Tag key={i} {...(attrs as Record<string, string>)} />;
      })}
    </svg>
  );
}
