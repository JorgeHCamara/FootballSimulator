import { Fragment } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import { JsonLd } from "./JsonLd.tsx";
import { inlineLinks } from "./LegalPage.tsx";
import { Link } from "../i18n/navigation.ts";
import { HREFLANG, SITE_NAME, SITE_URL } from "../lib/site.ts";

/** One section of the article (messages: HowItWorks.sections). */
export interface HowItWorksSection {
  id: string;
  h: string;
  p: string[];
}

/** The labelled worked example (HowItWorks.example), shown after the section on reading probabilities. */
export interface HowItWorksExample {
  title: string;
  setup: string;
  xg: string;
  outcomes: string;
  scores: string;
  note: string;
}

export interface HowItWorksCopy {
  title: string;
  description: string;
  deck: string;
  diagramLabel: string;
  diagram: { title: string; text: string }[];
  sections: HowItWorksSection[];
  example: HowItWorksExample;
  breadcrumb: string;
  breadcrumbHome: string;
}

/** The diagram's steps, in order: data, ratings, 10,000 simulations, probabilities. */
const STEP_ICONS: readonly IconName[] = ["table", "trending-up", "dices", "chart-column"];
/** The worked example goes right after this section. */
const EXAMPLE_AFTER = "reading";
/** The diagram goes right after this one (what FootSimu is). */
const DIAGRAM_AFTER = "what";

const prose = "leading-relaxed text-zinc-700 dark:text-zinc-300";

/**
 * "How FootSimu works": the methodology, as plain sections from the messages,
 * with a four-step diagram and a labelled example. Server-rendered and static:
 * no data is read, nothing of it goes to the browser as messages.
 */
export function HowItWorksPage({ locale, copy }: { locale: string; copy: HowItWorksCopy }) {
  const url = `${SITE_URL}/${locale}/how-it-works`;
  const organization = { "@type": "Organization", name: SITE_NAME, url: SITE_URL };
  return (
    <article className="mx-auto max-w-3xl space-y-6 py-2" data-testid="how-it-works-page">
      <JsonLd
        data={[
          {
            "@type": "Article",
            headline: copy.title,
            description: copy.description,
            inLanguage: HREFLANG[locale],
            url,
            mainEntityOfPage: url,
            author: organization,
            publisher: organization,
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: copy.breadcrumbHome, item: `${SITE_URL}/${locale}` },
              { "@type": "ListItem", position: 2, name: copy.title, item: url },
            ],
          },
        ]}
      />
      <nav aria-label={copy.breadcrumb} className="flex min-w-0 items-center text-xs text-zinc-500">
        <Link href="/" className="shrink-0 hover:underline">
          {copy.breadcrumbHome}
        </Link>
        <Icon name="chevron-right" size={12} className="mx-1 shrink-0" />
        <span className="truncate" aria-current="page">
          {copy.title}
        </span>
      </nav>
      <header className="space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight">{copy.title}</h1>
        <p className="text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">{copy.deck}</p>
      </header>
      {copy.sections.map((section) => (
        <Fragment key={section.id}>
          <section className="space-y-2" id={section.id}>
            <h2 className="text-lg font-bold tracking-tight">{section.h}</h2>
            {section.p.map((text, i) => (
              <p key={i} className={prose}>
                {inlineLinks(text)}
              </p>
            ))}
          </section>
          {section.id === DIAGRAM_AFTER && <Diagram label={copy.diagramLabel} steps={copy.diagram} />}
          {section.id === EXAMPLE_AFTER && <Example example={copy.example} />}
        </Fragment>
      ))}
    </article>
  );
}

/** Data → ratings → 10,000 simulations → probabilities: stacked on phones, a row from tablets up. Numbered and captioned, so colour carries nothing. */
function Diagram({ label, steps }: { label: string; steps: { title: string; text: string }[] }) {
  return (
    <figure className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" data-testid="how-it-works-diagram">
      <figcaption className="mb-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">{label}</figcaption>
      <ol className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-stretch">
        {steps.map((step, i) => (
          <Fragment key={step.title}>
            {i > 0 && (
              <li aria-hidden className="flex items-center justify-center text-zinc-400 dark:text-zinc-500">
                <Icon name="arrow-down" size={18} className="sm:hidden" />
                <Icon name="arrow-right" size={18} className="hidden sm:block" />
              </li>
            )}
            <li className="flex flex-1 items-center gap-3 rounded-lg bg-pitch-50 p-3 sm:flex-col sm:items-center sm:text-center dark:bg-pitch-900/40" data-testid="how-it-works-step">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pitch-600 text-white dark:bg-pitch-500">
                <Icon name={STEP_ICONS[i] ?? "info"} size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  <span className="sr-only">{i + 1}. </span>
                  {step.title}
                </span>
                <span className="block text-xs leading-snug text-zinc-600 dark:text-zinc-400">{step.text}</span>
              </span>
            </li>
          </Fragment>
        ))}
      </ol>
    </figure>
  );
}

/** The worked example: the assumptions, then expected goals, the three outcomes and the likeliest scores. */
function Example({ example }: { example: HowItWorksExample }) {
  return (
    <aside className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900" data-testid="how-it-works-example">
      <p className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
        <Icon name="info" size={16} className="shrink-0 text-pitch-700 dark:text-pitch-100" />
        {example.title}
      </p>
      <p className={`text-sm ${prose}`}>{example.setup}</p>
      <ul className="space-y-1 text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
        <li>{example.xg}</li>
        <li>{example.outcomes}</li>
        <li>{example.scores}</li>
      </ul>
      <p className={`text-sm ${prose}`}>{example.note}</p>
    </aside>
  );
}
