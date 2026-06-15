/**
 * Cloudflare-style authorization cascade (modelled on cms F134) + a
 * membership-validated tenant selector (modelled on trail). Optional, zero-dep,
 * framework-free — simple adopters ignore this export and use `hasScope` instead.
 */

/** A permission string: `"area:action"`, `"area:*"`, or `"*"`. */
export type Permission = string;

export interface ResourceFilter {
  /** Consumer-defined resource scope, e.g. "org" | "site" | "admin-area". */
  scope: string;
  effect: "include" | "exclude";
  /** `"*"` = every target in the scope, or an explicit id list. */
  targets: "*" | string[];
}

export interface IpFilter {
  mode: "in" | "not_in";
  cidrs: string[];
}

/** What a token is permitted to do — the stored grant. */
export interface TokenGrant {
  permissions: Permission[];
  resources?: ResourceFilter[];
  ipFilters?: IpFilter[];
  /** Epoch ms; the token is invalid before this. */
  notBefore?: number;
  /** Epoch ms; the token is invalid after this. */
  notAfter?: number;
}

/** What the current request needs — checked against the grant. */
export interface AuthContext {
  permission: Permission;
  resource?: { scope: string; target: string };
  ip?: string;
  now?: number;
}

export interface AuthDecision {
  allowed: boolean;
  reason?: string;
}

const deny = (reason: string): AuthDecision => ({ allowed: false, reason });

/**
 * Evaluate a token grant against a request context. The cascade is, in order:
 * TTL → permission → resource (exclude wins) → CIDR. The first failing gate
 * returns `{ allowed: false, reason }`; all passing returns `{ allowed: true }`.
 */
export function evaluateToken(grant: TokenGrant, ctx: AuthContext): AuthDecision {
  const now = ctx.now ?? Date.now();

  if (grant.notBefore != null && now < grant.notBefore) return deny("not_yet_valid");
  if (grant.notAfter != null && now > grant.notAfter) return deny("expired");

  if (!grant.permissions.some((p) => permissionMatches(p, ctx.permission))) return deny("permission_denied");

  if (grant.resources?.length && ctx.resource) {
    if (!resourceAllowed(grant.resources, ctx.resource)) return deny("resource_denied");
  }

  if (grant.ipFilters?.length && ctx.ip) {
    if (!ipAllowed(grant.ipFilters, ctx.ip)) return deny("ip_denied");
  }

  return { allowed: true };
}

/** A granted permission pattern satisfies a concrete required permission. */
function permissionMatches(granted: Permission, required: Permission): boolean {
  if (granted === "*" || granted === required) return true;
  const [gArea, gAction] = granted.split(":");
  const [rArea] = required.split(":");
  return gAction === "*" && gArea === rArea && rArea !== undefined;
}

function resourceAllowed(filters: ResourceFilter[], res: { scope: string; target: string }): boolean {
  const relevant = filters.filter((f) => f.scope === res.scope);
  if (relevant.length === 0) return true; // no constraint on this scope

  // exclude wins outright
  for (const f of relevant) {
    if (f.effect === "exclude" && targetMatches(f.targets, res.target)) return false;
  }
  const includes = relevant.filter((f) => f.effect === "include");
  if (includes.length === 0) return true; // only excludes existed, none matched
  return includes.some((f) => targetMatches(f.targets, res.target));
}

function targetMatches(targets: "*" | string[], target: string): boolean {
  return targets === "*" || targets.includes(target);
}

function ipAllowed(filters: IpFilter[], ip: string): boolean {
  for (const f of filters) {
    const inAny = f.cidrs.some((c) => ipInCidr(ip, c));
    if (f.mode === "in" && !inAny) return false;
    if (f.mode === "not_in" && inAny) return false;
  }
  return true;
}

// ---- CIDR matcher (IPv4 + IPv6, zero-dep) ---------------------------------

interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

/** True if `ip` falls within `cidr` (e.g. "10.0.0.0/8", "2001:db8::/32"). A bare IP = exact match. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.lastIndexOf("/");
  const addr = parseIp(ip);
  if (!addr) return false;

  if (slash === -1) {
    const exact = parseIp(cidr);
    return !!exact && exact.version === addr.version && exact.value === addr.value;
  }

  const network = parseIp(cidr.slice(0, slash));
  const bits = Number(cidr.slice(slash + 1));
  if (!network || network.version !== addr.version || !Number.isInteger(bits)) return false;

  const total = addr.version === 4 ? 32 : 128;
  if (bits < 0 || bits > total) return false;

  const mask = bits === 0 ? 0n : ((1n << BigInt(total)) - 1n) ^ ((1n << BigInt(total - bits)) - 1n);
  return (addr.value & mask) === (network.value & mask);
}

function parseIp(ip: string): ParsedIp | null {
  if (ip.includes(":")) {
    const v = ipv6ToBig(ip);
    return v === null ? null : { version: 6, value: v };
  }
  const v = ipv4ToBig(ip);
  return v === null ? null : { version: 4, value: v };
}

function ipv4ToBig(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function ipv6ToBig(ip: string): bigint | null {
  if (!ip.includes(":")) return null;
  // at most one "::" run
  if (ip.indexOf("::") !== ip.lastIndexOf("::")) return null;

  let groups: string[];
  if (ip.includes("::")) {
    const [head, tail] = ip.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - (headParts.length + tailParts.length);
    if (missing < 0) return null;
    groups = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  } else {
    groups = ip.split(":");
  }
  if (groups.length !== 8) return null;

  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  return v;
}

// ---- Tenant selector (trail's selector-not-grant) -------------------------

export class TenantAccessError extends Error {
  constructor(public readonly slug: string) {
    super(`not a member of tenant: ${slug}`);
    this.name = "TenantAccessError";
  }
}

/**
 * Resolve which tenant a request targets, modelling trail's "selector-not-grant"
 * rule: a key that `spansAll` lets the owner pick any tenant they're a member of
 * via `requestedSlug`; a non-member slug is a HARD refuse (throws
 * `TenantAccessError` → map to 401) — never a silent fall-back to home. A
 * home-bound key (`spansAll: false`) ignores the selector and returns home.
 */
export function selectTenant(o: {
  requestedSlug?: string;
  homeTenant: string;
  spansAll: boolean;
  isMember: (slug: string) => boolean;
}): string {
  const { requestedSlug, homeTenant, spansAll, isMember } = o;
  if (!spansAll) return homeTenant; // home-bound / legacy: selector ignored
  if (!requestedSlug || requestedSlug === homeTenant) return homeTenant;
  if (!isMember(requestedSlug)) throw new TenantAccessError(requestedSlug);
  return requestedSlug;
}
