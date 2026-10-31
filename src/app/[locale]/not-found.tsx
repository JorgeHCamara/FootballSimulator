import { useTranslations } from "next-intl";
import { Link } from "../../i18n/navigation.ts";

export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Link href="/" className="mt-4 inline-block text-pitch-600 underline">
        {t("back")}
      </Link>
    </div>
  );
}
