import { useTranslations } from "next-intl";
import { Link } from "../i18n/navigation.ts";
import { BrandMark } from "./BrandMark.tsx";
import { LanguageSwitcher } from "./LanguageSwitcher.tsx";
import { LeagueMenu } from "./LeagueMenu.tsx";

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
      <LeagueMenu />
    </header>
  );
}
