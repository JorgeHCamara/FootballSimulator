"use client";

import { useLinkStatus } from "next/link";
import { Icon, type IconName } from "./Icon.tsx";

/**
 * A link's icon that turns into a spinner from the click until the next page
 * shows (a page worked out on its first visit can take a few seconds), so
 * the click is seen to have worked. Inside a Link only.
 */
export function LinkPendingIcon({ name, size = 18 }: { name: IconName; size?: number }) {
  const { pending } = useLinkStatus();
  return pending ? <Icon name="loader-circle" size={size} className="animate-spin" data-testid="link-pending" /> : <Icon name={name} size={size} />;
}
