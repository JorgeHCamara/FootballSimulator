import type { ComponentProps } from "react";
import { Icon } from "./Icon.tsx";
import { ShareMenu } from "./ShareMenu.tsx";

type Share = Omit<ComponentProps<typeof ShareMenu>, "variant">;

/**
 * A card to share, shown as it will look, with the share menu beside it (a
 * thumb bar on phones): on club pages and in a report's movers. The image is
 * the card itself (share.imagePath), loaded when it scrolls into view.
 */
export function ShareCardBlock({ title, body, alt, share, testId }: { title: string; body: string; alt: string; share: Share; testId: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center dark:border-zinc-800 dark:bg-zinc-900" data-testid={testId}>
      <a href={share.imagePath} target="_blank" rel="noopener" className="block shrink-0 overflow-hidden rounded-lg border border-zinc-200 sm:w-72 dark:border-zinc-800">
        {/* eslint-disable-next-line @next/next/no-img-element -- the generated card itself, as it's shared */}
        <img src={share.imagePath} alt={alt} width={1200} height={630} loading="lazy" decoding="async" className="block aspect-[1200/630] h-auto w-full bg-pitch-700" data-testid={`${testId}-image`} />
      </a>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h3 className="flex items-start gap-2 font-bold">
            <Icon name="image" size={18} className="mt-0.5 shrink-0 text-pitch-600" />
            {title}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>
        </div>
        <div className="hidden sm:block">
          <ShareMenu {...share} variant="inline" align="left" />
        </div>
        <div className="sm:hidden">
          <ShareMenu {...share} variant="bar" />
        </div>
      </div>
    </div>
  );
}
