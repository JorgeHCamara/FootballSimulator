"use client";

import { track } from "@vercel/analytics";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon.tsx";

interface Props {
  /** The page to share, e.g. "/en/premier-league/share/Ag…" (made absolute when shared). */
  path: string;
  /** Its card image (PNG), for "Share image" and "Download image". */
  imagePath: string;
  title: string;
  text: string;
  /** League code, for the analytics event. */
  league: string;
  /** "inline": a button next to the table (desktop); "bar": a full-width thumb bar (phones). */
  variant: "inline" | "bar";
}

type Channel = "native" | "image" | "copy" | "x" | "whatsapp" | "reddit" | "facebook" | "download";

/** Which channel people share through (Vercel Analytics custom event). */
const report = (channel: Channel, league: string) => {
  try {
    track("Share", { channel, league });
  } catch {
    // Analytics must never break sharing.
  }
};

/** Phones and tablets: the native share sheet is the main way to share. */
const isTouch = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const hasNativeShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * Share a prediction. On phones the button opens the native share sheet
 * (WhatsApp, Messages, Instagram…) and, where the browser can share files,
 * "Share image" sends the card itself (Stories, Status). On desktop, or when
 * the native sheet is missing or fails, a menu: copy the link, X, WhatsApp,
 * Reddit, Facebook, download the card.
 */
export function ShareMenu({ path, imagePath, title, text, league, variant }: Props) {
  const t = useTranslations("Simulator");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [image, setImage] = useState<{ state: "idle" | "loading" | "ready"; file?: File; for?: string }>({ state: "idle" });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const probe = new File([new Uint8Array(1)], "probe.png", { type: "image/png" });
      setCanShareFiles(hasNativeShare() && typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  // A changed prediction is another image.
  useEffect(() => {
    if (image.for && image.for !== imagePath) setImage({ state: "idle" });
  }, [imagePath, image.for]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const url = () => new URL(path, window.location.origin).toString();

  const nativeShare = async () => {
    report("native", league);
    try {
      await navigator.share({ title, text, url: url() });
      setOpen(false);
    } catch (error) {
      // Closing the sheet isn't a failure; anything else falls back to the menu.
      if ((error as Error)?.name === "AbortError") return;
      setNotice(t("shareFailed"));
      setOpen(true);
    }
  };

  const onPrimary = () => {
    setNotice(null);
    if (isTouch() && hasNativeShare()) void nativeShare();
    else setOpen((o) => !o);
  };

  const shareImage = async () => {
    report("image", league);
    let file = image.for === imagePath ? image.file : undefined;
    if (!file) {
      setImage({ state: "loading", for: imagePath });
      try {
        const blob = await (await fetch(imagePath)).blob();
        file = new File([blob], "footsimu-prediction.png", { type: "image/png" });
      } catch {
        setImage({ state: "idle" });
        setNotice(t("shareFailed"));
        setOpen(true);
        return;
      }
      setImage({ state: "ready", file, for: imagePath });
    }
    try {
      await navigator.share({ files: [file], title, text: `${text} ${url()}` });
    } catch (error) {
      const name = (error as Error)?.name;
      if (name === "AbortError") return;
      // iOS needs the tap itself: the image is ready, the next tap shares it.
      if (name === "NotAllowedError") return;
      setNotice(t("shareFailed"));
      setOpen(true);
    }
  };

  const copy = async () => {
    report("copy", league);
    try {
      await navigator.clipboard.writeText(url());
    } catch {
      window.prompt(t("copyLink"), url());
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const enc = encodeURIComponent;
  const links = () => {
    const u = url();
    return [
      { channel: "x" as const, label: t("shareX"), href: `https://x.com/intent/post?text=${enc(text)}&url=${enc(u)}` },
      { channel: "whatsapp" as const, label: t("shareWhatsApp"), href: `https://wa.me/?text=${enc(`${text} ${u}`)}` },
      { channel: "reddit" as const, label: t("shareReddit"), href: `https://www.reddit.com/submit?url=${enc(u)}&title=${enc(title)}` },
      { channel: "facebook" as const, label: t("shareFacebook"), href: `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}` },
    ];
  };

  const item = "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800";
  const imageLabel = image.state === "loading" ? t("sharePreparing") : image.state === "ready" ? t("shareImageReady") : t("shareImage");
  const menu = open && (
    <div
      role="menu"
      aria-label={t("shareMenu")}
      data-testid="share-menu"
      className={`absolute z-30 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 ${
        variant === "bar" ? "bottom-full right-0 mb-2" : "right-0 top-full mt-2"
      }`}
    >
      {notice && <p className="px-3 py-2 text-xs text-zinc-500" role="status">{notice}</p>}
      <button type="button" role="menuitem" className={item} onClick={copy} data-testid="share-copy">
        <Icon name={copied ? "check" : "link"} />
        {copied ? t("copied") : t("copyLink")}
      </button>
      {typeof window !== "undefined" &&
        links().map((link) => (
          <a key={link.channel} role="menuitem" className={item} href={link.href} target="_blank" rel="noopener noreferrer" onClick={() => report(link.channel, league)} data-testid={`share-${link.channel}`}>
            <Icon name={CHANNEL_ICONS[link.channel]} />
            {link.label}
          </a>
        ))}
      <a role="menuitem" className={item} href={imagePath} download="footsimu-prediction.png" onClick={() => report("download", league)} data-testid="share-download">
        <Icon name="download" />
        {t("downloadImage")}
      </a>
      {hasNativeShare() && (
        <button type="button" role="menuitem" className={item} onClick={() => void nativeShare()}>
          <Icon name="share-2" />
          {t("shareNative")}
        </button>
      )}
    </div>
  );

  if (variant === "bar") {
    return (
      <div ref={rootRef} className="relative flex gap-2" data-testid="share-bar">
        <button
          type="button"
          onClick={onPrimary}
          className="flex h-11 grow items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-base font-semibold text-white active:bg-pitch-700"
          data-testid="share-button"
        >
          <ShareIcon />
          {t("share")}
        </button>
        {canShareFiles && (
          <button
            type="button"
            onClick={() => void shareImage()}
            disabled={image.state === "loading"}
            className="flex h-11 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
            data-testid="share-image"
          >
            <Icon name="image" />
            <span className="max-w-32 truncate">{imageLabel}</span>
          </button>
        )}
        <button
          type="button"
          aria-label={t("shareMenu")}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-lg font-bold dark:border-zinc-700 dark:bg-zinc-900"
          data-testid="share-more"
        >
          <Icon name="ellipsis" size={20} />
        </button>
        {menu}
      </div>
    );
  }
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={onPrimary}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        data-testid="share-button"
      >
        <ShareIcon />
        {t("share")}
      </button>
      {menu}
    </div>
  );
}

function ShareIcon() {
  return <Icon name="share" />;
}

/** Lucide has no brand logos: generic icons for each network. */
const CHANNEL_ICONS: Record<"x" | "whatsapp" | "reddit" | "facebook", IconName> = {
  x: "send",
  whatsapp: "message-circle",
  reddit: "messages-square",
  facebook: "thumbs-up",
};
