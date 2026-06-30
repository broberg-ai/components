"use client";

import { useState, useEffect } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@radix-ui/react-avatar";
import { gravatarUrl, getInitials } from "./index.js";

type Size = "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<Size, { px: number; cls: string; textCls: string }> = {
  sm: { px: 32, cls: "h-8 w-8 rounded-full overflow-hidden", textCls: "text-xs" },
  md: { px: 40, cls: "h-10 w-10 rounded-full overflow-hidden", textCls: "text-sm" },
  lg: { px: 48, cls: "h-12 w-12 rounded-full overflow-hidden", textCls: "text-base" },
  xl: { px: 64, cls: "h-16 w-16 rounded-full overflow-hidden", textCls: "text-xl" },
};

export interface GravatarAvatarProps {
  email?: string | null;
  name?: string | null;
  size?: Size;
  uploadedSrc?: string | null;
  className?: string;
}

/** Stack A avatar with 3-tier fallback: uploadedSrc → Gravatar → initials.
 *  Uses @radix-ui/react-avatar (the same package shadcn wraps). */
export function GravatarAvatar({
  email,
  name,
  size = "md",
  uploadedSrc,
  className,
}: GravatarAvatarProps) {
  const config = SIZE_MAP[size];
  const initials = getInitials(name, email);

  const [tier, setTier] = useState<0 | 1 | 2>(
    uploadedSrc ? 0 : email ? 1 : 2,
  );
  const [gravatarSrc, setGravatarSrc] = useState<string | null>(null);

  useEffect(() => {
    setTier(uploadedSrc ? 0 : email ? 1 : 2);
    setGravatarSrc(null);
    if (email) {
      let alive = true;
      gravatarUrl(email, { size: config.px * 2, default: "404" }).then(
        (u) => { if (alive) setGravatarSrc(u); },
      );
      return () => { alive = false; };
    }
  }, [email, uploadedSrc, config.px]);

  let src: string | null = null;
  if (tier === 0 && uploadedSrc) src = uploadedSrc;
  else if (tier === 1 && gravatarSrc) src = gravatarSrc;

  const rootCls = [config.cls, className].filter(Boolean).join(" ");

  return (
    <Avatar className={rootCls} data-testid="gravatar-avatar">
      {src && (
        <AvatarImage
          src={src}
          alt={name || email || "avatar"}
          referrerPolicy="no-referrer"
          onError={() => setTier((t) => (t < 2 ? ((t + 1) as 0 | 1 | 2) : 2))}
        />
      )}
      <AvatarFallback className={config.textCls}>{initials}</AvatarFallback>
    </Avatar>
  );
}
