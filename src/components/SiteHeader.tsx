import { useTranslations } from "next-intl";
import { LEAGUES } from "../config/leagues.ts";
import { Link } from "../i18n/navigation.ts";
import { BrandMark } from "./BrandMark.tsx";
import { Flag } from "./Flag.tsx";
import { LanguageSwitcher } from "./LanguageSwitcher.tsx";

export function SiteHeader() {
  const t = useTranslations("Nav");
  return (
    <header className="bg-pitch-700 text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight" aria-label={`Foot Simu – ${t("home")}`}>
          <BrandMark size={28} />
          <span>
            Foot <span className="text-pitch-100">Simu</span>
          </span>
        </Link>
        <div className="ml-auto">
          <LanguageSwitcher />
        </div>
      </div>
      <nav className="border-t border-white/10 bg-pitch-900/40">
        <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-1.5 text-sm whitespace-nowrap">
          {LEAGUES.map((l) => (
            <li key={l.code}>
              <Link href={`/${l.slug}`} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-pitch-50 hover:bg-white/10">
                <Flag code={l.flag} width={18} />
                {l.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
