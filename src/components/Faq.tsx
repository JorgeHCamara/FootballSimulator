import type { FaqItem } from "../lib/site.ts";

export function Faq({ title, items }: { title: string; items: FaqItem[] }) {
  return (
    <section aria-labelledby="faq-title" className="space-y-3">
      <h2 id="faq-title" className="text-xl font-bold tracking-tight">
        {title}
      </h2>
      <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {items.map((item) => (
          <details key={item.q} className="group px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
              <h3 className="text-base">{item.q}</h3>
              <span aria-hidden className="text-zinc-400 transition group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
