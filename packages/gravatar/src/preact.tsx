/** @jsxImportSource preact */

import { useEffect, useState } from "preact/hooks";
import { gravatarUrl, getInitials } from "./index.js";

type Size = "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<Size, number> = {
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
};

export interface AvatarProps {
  email?: string | null;
  name?: string | null;
  size?: Size;
  uploadedSrc?: string | null;
  class?: string;
}

/** Stack B (Preact) avatar with 3-tier fallback: uploadedSrc → Gravatar → initials.
 *  No shadcn/Tailwind dependency — consumers style via `av av-{px}` CSS classes. */
export function Avatar({
  email,
  name,
  size = "md",
  uploadedSrc,
  class: cls = "",
}: AvatarProps) {
  const px = SIZE_PX[size];
  const initials = getInitials(name, email);

  const [tier, setTier] = useState<0 | 1 | 2>(
    uploadedSrc ? 0 : email ? 1 : 2,
  );
  const [gravatarSrc, setGravatarSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setTier(uploadedSrc ? 0 : email ? 1 : 2);
    setGravatarSrc(null);
    if (email) {
      gravatarUrl(email, { size: px * 2, default: "404" }).then(
        (u) => { if (alive) setGravatarSrc(u); },
      );
    }
    return () => { alive = false; };
  }, [email, uploadedSrc, px]);

  let src: string | null = null;
  if (tier === 0 && uploadedSrc) src = uploadedSrc;
  else if (tier === 1 && gravatarSrc) src = gravatarSrc;

  const klass = `av av-${px}${cls ? " " + cls : ""}`;

  if (src) {
    return (
      <img
        class={klass}
        src={src}
        alt={initials}
        referrerpolicy="no-referrer"
        loading="lazy"
        style="object-fit:cover;"
        data-testid="gravatar-avatar"
        onError={() => setTier((t) => (t < 2 ? ((t + 1) as 0 | 1 | 2) : 2))}
      />
    );
  }

  return (
    <span class={klass} data-testid="gravatar-avatar">
      {initials}
    </span>
  );
}
