import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { pickMessages, type MessageScope } from "../i18n/clientMessages.ts";

/**
 * The messages a page's own client components use (its scope, see
 * src/i18n/clientMessages.ts), for what's inside: the layout sends only the
 * header's. Renders nothing of its own.
 */
export async function ClientMessages({ scope, children }: { scope: MessageScope; children: ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <NextIntlClientProvider locale={locale} messages={pickMessages(messages, scope)}>
      {children}
    </NextIntlClientProvider>
  );
}
