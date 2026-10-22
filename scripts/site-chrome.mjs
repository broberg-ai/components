// The Discovery site's ONE design source (F038.30): tokens, base styles and the
// top bar. The landing page (build-inventory.mjs) and the live /tickets page
// (apps/discovery/ticket-registry.ts) both render from this, so the two cannot
// drift — a copy of this CSS anywhere else is the bug this file exists to stop.

export const SITE_CSS = `
  :root, [data-theme="dark"]{--bg:oklch(0.211 0 0);--panel:oklch(0.239 0 0);--card:oklch(0.262 0 0);--fg:oklch(0.985 0 0);--muted:oklch(0.66 0 0);--faint:oklch(0.52 0 0);--border:oklch(0.32 0 0);--primary:oklch(0.922 0 0);--primary-fg:oklch(0.205 0 0);--green:oklch(0.74 0.15 152);--amber:oklch(0.80 0.13 80);}
  [data-theme="dark-cool"]{--bg:oklch(0.175 0.015 255);--panel:oklch(0.22 0.015 255);--card:oklch(0.25 0.015 255);--fg:oklch(0.93 0.008 255);--muted:oklch(0.66 0.015 255);--faint:oklch(0.5 0.015 255);--border:oklch(0.33 0.012 255);--primary:oklch(0.922 0 0);--primary-fg:oklch(0.205 0 0);--green:oklch(0.74 0.15 152);--amber:oklch(0.80 0.13 80);}
  [data-theme="dark-warm"]{--bg:oklch(0.175 0.008 55);--panel:oklch(0.22 0.012 60);--card:oklch(0.25 0.012 60);--fg:oklch(0.90 0.012 75);--muted:oklch(0.64 0.015 60);--faint:oklch(0.5 0.015 60);--border:oklch(0.33 0.015 60);--primary:oklch(0.922 0 0);--primary-fg:oklch(0.205 0 0);--green:oklch(0.74 0.15 152);--amber:oklch(0.80 0.13 80);}
  [data-theme="light"]{--bg:oklch(0.985 0 0);--panel:oklch(0.97 0 0);--card:oklch(1 0 0);--fg:oklch(0.205 0 0);--muted:oklch(0.5 0 0);--faint:oklch(0.62 0 0);--border:oklch(0.9 0 0);--primary:oklch(0.25 0 0);--primary-fg:oklch(0.985 0 0);--green:oklch(0.52 0.15 152);--amber:oklch(0.58 0.13 70);}
  [data-theme="light-cool"]{--bg:oklch(0.98 0.004 255);--panel:oklch(0.96 0.008 255);--card:oklch(1 0 0);--fg:oklch(0.22 0.025 255);--muted:oklch(0.5 0.015 255);--faint:oklch(0.62 0.012 255);--border:oklch(0.88 0.01 255);--primary:oklch(0.25 0.02 255);--primary-fg:oklch(0.985 0 0);--green:oklch(0.52 0.15 152);--amber:oklch(0.58 0.13 70);}
  [data-theme="light-warm"]{--bg:oklch(0.98 0.01 85);--panel:oklch(0.96 0.012 80);--card:oklch(1 0 0);--fg:oklch(0.22 0.025 65);--muted:oklch(0.5 0.02 65);--faint:oklch(0.62 0.015 70);--border:oklch(0.86 0.02 75);--primary:oklch(0.25 0.02 65);--primary-fg:oklch(0.985 0 0);--green:oklch(0.52 0.15 152);--amber:oklch(0.58 0.13 60);}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth;scrollbar-gutter:stable}
  body{background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;transition:background .25s,color .25s}
  .wrap{max-width:1200px;margin:0 auto;padding:0 24px}
  .top{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);background:color-mix(in oklab,var(--bg) 80%,transparent);border-bottom:1px solid var(--border)}
  .top .wrap{display:flex;align-items:center;gap:16px;height:60px}
  .brand{font-weight:650;letter-spacing:-.01em;font-size:16px}
  .brand .at{color:var(--faint);font-weight:400}
  .spacer{flex:1}
  .seg{display:inline-flex;background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:3px;gap:2px}
  .seg button{font:inherit;font-size:12px;font-weight:600;color:var(--muted);background:none;border:0;border-radius:6px;padding:5px 11px;cursor:pointer;transition:.15s}
  .seg button:hover{color:var(--fg)}
  .seg button[aria-pressed="true"]{background:var(--card);color:var(--fg);box-shadow:0 1px 2px oklch(0 0 0 / .18)}
  .hero{padding:54px 0 30px}
  .hero h1{font-size:40px;line-height:1.05;font-weight:680;letter-spacing:-.025em;max-width:760px}
  .hero h1 .at{color:var(--faint);font-weight:400}
  .hero p{color:var(--muted);font-size:16px;margin-top:14px;max-width:640px}
  .hero code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--green);background:var(--panel);padding:2px 6px;border-radius:5px}
  .stats{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}
  .stat{background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:13px 18px;min-width:96px}
  .stat b{display:block;font-size:24px;font-weight:680;line-height:1}
  .stat span{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:5px;display:block}
  .stat.ship b{color:var(--green)}
  .featured{margin:30px 0 8px;background:linear-gradient(180deg,color-mix(in oklab,var(--green) 9%,var(--panel)),var(--panel));border:1px solid color-mix(in oklab,var(--green) 40%,var(--border));border-radius:16px;padding:22px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:20px}
  .featured .ttl{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green)}
  .featured h2{font-size:20px;font-weight:650;margin-top:4px}
  .featured .pkg{font:13px ui-monospace,monospace;color:var(--muted);margin-top:3px}
  .featured .cmd{margin-left:auto;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:11px 15px;font:13px ui-monospace,monospace;color:var(--fg)}
  .featured .cmd .p{color:var(--faint)}
  .controls{display:flex;flex-wrap:wrap;gap:18px;align-items:center;margin:34px 0 6px;padding-bottom:14px;border-bottom:1px solid var(--border)}
  .fil{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .fil .lbl{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-right:2px}
  .chip{font:inherit;font-size:12.5px;color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:7px;padding:5px 11px;cursor:pointer;transition:.15s}
  .chip:hover{color:var(--fg);border-color:var(--faint)}
  .chip[aria-pressed="true"]{background:var(--primary);color:var(--primary-fg);border-color:var(--primary)}
  .legend{margin-left:auto;font-size:12px;color:var(--faint);display:flex;gap:11px;flex-wrap:wrap}
  .layer{margin-top:30px}
  .layer-h{display:flex;align-items:baseline;gap:11px;margin-bottom:13px}
  .layer-h .n{font:700 12px ui-monospace,monospace;letter-spacing:.1em;color:var(--green);background:color-mix(in oklab,var(--green) 14%,transparent);padding:2px 8px;border-radius:6px}
  .layer-h .t{font-size:17px;font-weight:650}
  .layer-h .d{font-size:13px;color:var(--faint)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:12px}
  .c{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:14px 15px;display:flex;flex-direction:column;gap:9px;min-height:104px;cursor:pointer;transition:transform .14s,border-color .14s,box-shadow .14s}
  .c:hover{transform:translateY(-2px);border-color:var(--faint);box-shadow:0 8px 24px oklch(0 0 0 / .22)}
  .c:focus-visible{outline:2px solid var(--green);outline-offset:2px}
  .c:active{transform:translateY(0) scale(.997)}
  .c.shipped{border-color:color-mix(in oklab,var(--green) 55%,var(--border));box-shadow:0 0 0 1px color-mix(in oklab,var(--green) 26%,transparent) inset}
  .c.moved{opacity:.6;border-style:dashed}
  .c.hide,.ic.hide{display:none}
  .c-top{display:flex;align-items:flex-start;gap:9px}
  .fnum{font:600 11px ui-monospace,monospace;color:var(--faint);background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:2px 7px;white-space:nowrap}
  .nm{font-weight:600;font-size:14px;line-height:1.3}
  .pkg{font:11.5px ui-monospace,monospace;color:var(--muted)}
  .pkg.has{color:var(--green)}
  .pkg.none{color:var(--faint);opacity:.7}
  .c-bot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:auto;font-size:11.5px;color:var(--muted)}
  .model{font-size:14px}
  .ei{color:var(--faint)}
  .own{color:var(--faint);font-size:10.5px;background:var(--panel);border:1px solid var(--border);border-radius:5px;padding:1px 6px}
  .grad{color:var(--amber);font-weight:700;cursor:default}
  .badge{border-radius:6px;padding:2.5px 8px;font-size:10.5px;font-weight:700;letter-spacing:.02em;margin-left:auto;white-space:nowrap}
  .b-ship{background:color-mix(in oklab,var(--green) 20%,transparent);color:var(--green)}
  .b-back{background:var(--panel);color:var(--faint);border:1px solid var(--border)}
  .b-moved{background:color-mix(in oklab,var(--amber) 18%,transparent);color:var(--amber)}
  .drawer-backdrop{position:fixed;inset:0;z-index:40;background:oklch(0 0 0 / .5);opacity:0;pointer-events:none;transition:opacity .2s}
  .drawer-backdrop.open{opacity:1;pointer-events:auto}
  .drawer{position:fixed;top:0;right:0;z-index:41;height:100%;width:440px;max-width:92vw;background:var(--panel);border-left:1px solid var(--border);box-shadow:-14px 0 44px oklch(0 0 0 / .32);transform:translateX(100%);transition:transform .24s cubic-bezier(.4,0,.2,1);overflow-y:auto;padding:26px 26px 44px}
  .drawer.open{transform:translateX(0)}
  .drawer-x{position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-size:14px;cursor:pointer;transition:.15s;display:flex;align-items:center;justify-content:center}
  .drawer-x:hover{color:var(--fg);border-color:var(--faint)}
  .drawer-x:active{transform:scale(.92)}
  .drawer-x:focus-visible{outline:2px solid var(--green);outline-offset:2px}
  .d-head{display:flex;align-items:center;gap:9px;margin-bottom:13px;padding-right:84px;min-height:32px}
  .d-name{font-size:21px;font-weight:680;letter-spacing:-.02em;line-height:1.2;margin-bottom:7px;padding-right:34px}
  .d-pkg{font:12.5px ui-monospace,monospace;color:var(--green);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .d-pkg.none{color:var(--faint)}
  .d-pkg .badge{margin-left:0}
  .d-facts{display:grid;grid-template-columns:auto 1fr;gap:9px 16px;margin:18px 0;padding:16px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
  .d-facts dt{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);font-weight:700;padding-top:1px}
  .d-facts dd{font-size:13px;color:var(--fg)}
  .d-facts dd code{font:12px ui-monospace,monospace;background:var(--card);padding:1px 6px;border-radius:5px}
  .d-links a{color:var(--green);text-decoration:none;font-weight:600}
  .d-links a:hover{text-decoration:underline}
  .d-links-sep{color:var(--faint);margin:0 7px}
  .d-copy-x{position:absolute;top:16px;right:56px;width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-size:14px;cursor:pointer;transition:color .15s,border-color .15s,background .15s,transform .1s;display:flex;align-items:center;justify-content:center}
  .d-copy-x:hover{color:var(--fg);border-color:var(--faint)}
  .d-copy-x:active{transform:scale(.92)}
  .d-copy-x:focus-visible{outline:2px solid var(--green);outline-offset:2px}
  .d-copy-x .d-copy-ic{font-size:14px;line-height:1}
  .d-copy-x.ok{color:var(--green);border-color:color-mix(in oklab,var(--green) 55%,var(--border));background:color-mix(in oklab,var(--green) 14%,var(--card))}
  .d-copy-x.err{color:var(--amber);border-color:color-mix(in oklab,var(--amber) 45%,var(--border))}
  .sbtn{display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:12.5px;font-weight:600;color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:6px 12px;cursor:pointer;transition:color .15s,border-color .15s,transform .1s}
  .sbtn:hover{color:var(--fg);border-color:var(--faint)}
  .sbtn:active{transform:scale(.97)}
  .sbtn:focus-visible{outline:2px solid var(--green);outline-offset:2px}
  .sbtn .sk{font:11px ui-monospace,monospace;color:var(--faint);background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:1px 5px}
  .smod{position:fixed;inset:0;z-index:60;background:oklch(0 0 0 / .5);backdrop-filter:blur(3px);display:none;align-items:flex-start;justify-content:center;padding:14vh 16px 16px}
  .smod.open{display:flex}
  .sbox{width:100%;max-width:560px;background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px oklch(0 0 0 / .4);overflow:hidden}
  .sinput{width:100%;font:inherit;font-size:16px;color:var(--fg);background:transparent;border:0;border-bottom:1px solid var(--border);padding:16px 18px;outline:none}
  .sinput::placeholder{color:var(--faint)}
  .slist{max-height:52vh;overflow-y:auto;padding:6px}
  .sres{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;cursor:pointer}
  .sres.on,.sres:hover{background:var(--card)}
  .sres .sf{font:600 10.5px ui-monospace,monospace;color:var(--faint);background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:2px 6px;white-space:nowrap}
  .sres .snm{font-weight:600;font-size:13.5px;color:var(--fg)}
  .sres .spkg{font:11.5px ui-monospace,monospace;color:var(--green)}
  .sres .slay{margin-left:auto;font-size:10.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.05em}
  .sempty{padding:22px;text-align:center;color:var(--faint);font-size:13px}
  .sfoot{display:flex;gap:16px;padding:9px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--faint)}
  .d-model{font-size:12.5px;color:var(--muted);line-height:1.5;margin-top:3px}
  .d-desc-h{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);font-weight:700;margin:0 0 7px}
  .d-desc{font-size:14px;line-height:1.62;color:var(--fg)}
  footer{margin:48px 0 64px;border-top:1px solid var(--border);padding-top:26px;display:grid;grid-template-columns:1fr 1fr;gap:30px}
  footer h3{font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--faint);text-transform:uppercase;margin-bottom:12px}
  .spoke{font-size:13px;color:var(--muted);margin:5px 0}
  .spoke b{color:var(--fg)}
  .spoke .me{color:var(--green);font-weight:600}
  .spoke small{color:var(--faint);font-size:11px;margin-left:5px}
  .copyright{grid-column:1/-1;margin-top:6px;padding-top:20px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--faint);line-height:1.6}
  .copyright a{color:var(--green);text-decoration:none;font-weight:600}
  .copyright a:hover{text-decoration:underline}
  .cp p{font-size:13px;color:var(--muted);line-height:1.6}
  .cp code{font:12px ui-monospace,monospace;color:var(--fg);background:var(--panel);padding:1.5px 6px;border-radius:5px}
  .fleet{margin-top:42px}
  .fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:14px}
  .fc{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:13px 15px;display:flex;flex-direction:column;gap:7px}
  .fc.isnew{border-color:color-mix(in oklab,var(--green) 55%,var(--border));box-shadow:0 0 0 1px color-mix(in oklab,var(--green) 26%,transparent) inset}
  .fc-h{display:flex;align-items:center;gap:8px}
  .fs{font-weight:650;font-size:14.5px}
  .fnew{margin-left:auto;font-size:9.5px;font-weight:700;letter-spacing:.07em;color:var(--green);background:color-mix(in oklab,var(--green) 18%,transparent);border-radius:5px;padding:2px 7px}
  .fr{font-size:12px;color:var(--faint);line-height:1.4}
  .fpills{display:flex;flex-wrap:wrap;gap:5px;margin-top:3px}
  .fp{font:10.5px ui-monospace,SFMono-Regular,Menlo,monospace;border-radius:5px;padding:2px 7px;border:1px solid var(--border)}
  .fp.pub{color:var(--green);background:color-mix(in oklab,var(--green) 12%,transparent);border-color:color-mix(in oklab,var(--green) 35%,var(--border))}
  .fp.src{color:var(--amber);background:color-mix(in oklab,var(--amber) 10%,transparent);border-color:color-mix(in oklab,var(--amber) 30%,var(--border))}
  .fp.use{color:var(--muted);background:var(--panel)}
  .fscan{font:400 11px/1.5 ui-monospace,monospace;color:var(--dim,#777);margin:-4px 0 12px;letter-spacing:.02em}
.fstale{color:#c2410c;font-weight:700;letter-spacing:.06em}
.fnote{font-size:11px;color:var(--faint);font-style:italic}
  .flegend{margin-top:13px;font-size:11.5px;color:var(--faint);display:flex;gap:14px;flex-wrap:wrap;align-items:center}
  .infra{margin-top:42px}
  .igrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:14px}
  .ic{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:14px 15px;display:flex;flex-direction:column;gap:7px;cursor:pointer;transition:transform .14s,border-color .14s,box-shadow .14s}
  .ic:hover{transform:translateY(-2px);border-color:var(--faint);box-shadow:0 8px 24px oklch(0 0 0 / .22)}
  .ic:focus-visible{outline:2px solid var(--green);outline-offset:2px}
  .ic:active{transform:translateY(0) scale(.997)}
  .ic-h{display:flex;align-items:center;gap:8px}
  .icn{font-weight:650;font-size:15px}
  .ictip{margin-left:auto;font-size:10.5px;font-weight:700;color:var(--amber);background:color-mix(in oklab,var(--amber) 16%,transparent);border-radius:5px;padding:2px 7px}
  .icr{font-size:12.5px;color:var(--muted);line-height:1.4}
  .icreg{font-size:11px;color:var(--faint)}
  .tips{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
  .tips li{font-size:13px;line-height:1.5;color:var(--fg);padding-left:12px;border-left:2px solid color-mix(in oklab,var(--green) 40%,var(--border))}
  .tip-t{display:block}
  .tip-by{font-size:11px;color:var(--faint)}
  @media(max-width:760px){
    .wrap{padding:0 16px}
    .fgrid,.igrid{grid-template-columns:1fr}
    .top .wrap{height:auto;min-height:60px;flex-wrap:wrap;padding:10px 16px;gap:8px}
    .brand{flex:1 0 100%}
    .spacer{display:none}
    .seg button{padding:5px 9px;font-size:11px}
    .hero{padding:30px 0 20px}
    .hero h1{font-size:29px}
    .hero p{font-size:14.5px}
    .stat{flex:1 1 calc(50% - 6px);min-width:0}
    .featured{flex-direction:column;align-items:flex-start;gap:14px}
    .featured .cmd{margin-left:0}
    .controls{gap:12px}
    .legend{margin-left:0;width:100%;order:3}
    .grid{grid-template-columns:1fr}
    .drawer{width:100%;max-width:100%}
    footer{grid-template-columns:1fr;gap:22px}
  }
`;

/** The top-bar menu. `extra` is page-specific controls (the landing's ⌘K search). */
export const NAV = [
  { href: "/onboarding", label: "Start here ↗", testid: "inv-onboarding-link", title: "Start here — all packages by category + all tips" },
  { href: "/tickets", label: "BID-billetter", testid: "nav-tickets", title: "Hvilke apps og platforme logger ind med BID-billetter (WIF) — live fra BID" },
];

export function topBar({ active = "", extra = "" } = {}) {
  const links = NAV.map(
    (n) =>
      `<a href="${n.href}" data-testid="${n.testid}"${n.href === active ? ' aria-current="page"' : ""} style="font-size:13px;font-weight:600;color:${n.href === active ? "var(--fg)" : "var(--green)"};text-decoration:none;margin-left:14px" title="${n.title}">${n.label}</a>`,
  ).join("\n    ");
  return `<div class="top"><div class="wrap">
    <a href="/" class="brand" data-testid="nav-home" style="color:inherit;text-decoration:none"><span class="at">@broberg/</span>components</a>
    ${links}
    <span class="spacer"></span>
    ${extra}<div class="seg" id="mode"><button data-m="dark" aria-pressed="true" data-testid="theme-dark">Dark</button><button data-m="light" data-testid="theme-light">Light</button></div>
    <div class="seg" id="temp"><button data-t="" aria-pressed="true" data-testid="theme-neutral">Neutral</button><button data-t="-cool" data-testid="theme-cool">Cool</button><button data-t="-warm" data-testid="theme-warm">Warm</button></div>
  </div></div>`;
}

/** Theme switching for the top bar's two segmented controls. */
export const THEME_JS = [
"var modeEl=document.getElementById('mode'),tempEl=document.getElementById('temp');",
"var mode='dark',temp='';",
"function applyTheme(){document.documentElement.setAttribute('data-theme',mode+temp);}",
"if(modeEl)modeEl.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;mode=b.getAttribute('data-m');Array.prototype.forEach.call(modeEl.children,function(x){x.setAttribute('aria-pressed',x===b);});applyTheme();});",
"if(tempEl)tempEl.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;temp=b.getAttribute('data-t');Array.prototype.forEach.call(tempEl.children,function(x){x.setAttribute('aria-pressed',x===b);});applyTheme();});",
].join("\n");
