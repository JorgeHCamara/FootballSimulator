import type { ReactNode } from "react";
import { Link } from "../i18n/navigation.ts";

export interface LegalSection {
  h: string;
  p: string[];
}

/** Turns [label](href) in a message into links: site paths ("contact") localized, others plain. */
export function inlineLinks(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const [whole, label, href] = match as unknown as [string, string, string];
    if (match.index > last) parts.push(text.slice(last, match.index));
    const style = "font-medium text-pitch-700 underline underline-offset-2 hover:text-pitch-900 dark:text-pitch-100";
    parts.push(
      /^(https?:|mailto:)/.test(href) ? (
        <a key={parts.length} href={href} className={style} {...(href.startsWith("http") ? { rel: "noopener" } : {})}>
          {label}
        </a>
      ) : (
        <Link key={parts.length} href={`/${href}`} className={style}>
          {label}
        </Link>
      ),
    );
    last = match.index + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** About, Privacy and Contact: a title, an optional date and plain sections. */
export function LegalPage({ title, updated, sections }: { title: string; updated?: string; sections: LegalSection[] }) {
  return (
    <article className="mx-auto max-w-3xl space-y-6 py-2" data-testid="legal-page">
      <header className="space-y-1">
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        {updated && <p className="text-sm text-zinc-500">{updated}</p>}
      </header>
      {sections.map((section) => (
        <section key={section.h} className="space-y-2">
          <h2 className="text-lg font-bold tracking-tight">{section.h}</h2>
          {section.p.map((text, i) => (
            <p key={i} className="leading-relaxed text-zinc-700 dark:text-zinc-300">
              {inlineLinks(text)}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
