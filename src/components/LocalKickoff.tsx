"use client";

import { useEffect, useState } from "react";

interface Props {
  /** Kick-off, as an ISO time. */
  iso: string;
  locale: string;
  /** The league's time zone, used on the server and until the visitor's own clock takes over. */
  timeZone: string;
  /** "your time". */
  yourTime: string;
}

const format = (iso: string, locale: string, timeZone: string | undefined, zoneName: boolean) => {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(date);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}), ...(zoneName ? { timeZoneName: "short" } : {}) }).format(date);
  return `${day} · ${time}`;
};

/** A game's date and kick-off: in the league's time zone first, then in the visitor's own. */
export function LocalKickoff({ iso, locale, timeZone, yourTime }: Props) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setLocal(own && own !== timeZone ? `${format(iso, locale, own, false)} (${yourTime})` : null);
  }, [iso, locale, timeZone, yourTime]);
  return (
    <time dateTime={iso} data-testid="match-kickoff">
      {local ?? format(iso, locale, timeZone, true)}
    </time>
  );
}
