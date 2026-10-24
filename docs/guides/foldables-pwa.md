# Foldeskærme — udviklingsstandard for alle vores PWA'er

> Ejerens ordre 24/10 2026: alle apps skal læse denne vejledning. Den gælder iPhone Duo og
> tilsvarende telefoner med fold- eller klapskærm (Samsung Galaxy Z Fold/Flip, Pixel Fold m.fl.).
> Kortversionen til agenter står i Discovery under **Frontend → tip «foldables»**
> (`GET https://discovery.broberg.ai/api/infra/frontend`).

## Formål

Én fælles standard, så hver PWA fungerer på tværs af skærmstørrelser, foldetilstande og
orienteringer — i Safari på iPhone Duo og i Chromium-browsere på Android-foldetelefoner.

## Officielle referencer

1. **Apple HIG — Designing for iPhone Duo**
   https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo
   Designreference for brugeroplevelse, navigation, layout og indhold på tværs af skærmene.
2. **WebKit — WebKit Features for Safari 27.1**
   https://webkit.org/blog/18486/webkit-features-for-safari-27-1/
   Den primære webtekniske reference: viewport, foldetilstand, viewport-segmenter.
3. **Apple Developer — iPhone Duo**
   https://developer.apple.com/iphone-duo/
   Indgang til Apples udviklerressourcer (Xcode 27.1, HIG, design-ressourcer).

## Hvad vi ved (målt på WebKit-siden 24/10 2026)

- iPhone Duo kører samme WebKit som andre iPhones — eksisterende sites virker uden ændringer.
- **Ydre skærm:** bredere og *lavere* end andre iPhones; Safari flytter sine knapper ud til siden
  for at give indholdet højde. Siden tegnes endnu **ikke** ind under de knapper — Safari fylder
  pladsen med sidens baggrundsfarve. Sæt derfor altid en rigtig `body`-baggrund.
- **Indre skærm:** fanebjælken står øverst. I liggende retning med to vinduer side om side får
  hvert vindue et **smalt, stående** viewport.
- Viewport spænder fra **382 til 951 CSS-pixels i bredden** og **368 til 902 i højden**, afhængigt
  af hvordan telefonen holdes og foldes.
- **Device Posture API** og **Viewport Segments API** er i Safari 27.1 kun en *udvikler-forhåndsvisning*
  bag feature flags (Indstillinger › Apps › Safari › Avanceret › Feature Flags). De må aldrig være
  en forudsætning for at appen virker.
- Android-foldetelefoner: Chromium har sin egen understøttelse af de samme API'er. Tjek MDN/caniuse
  når du bygger — antag intet.

## Udviklingskrav

- Responsiv CSS, mobile-first: CSS Grid, Flexbox, flydende størrelser.
- **Aldrig** hardcodede enhedsmål og **aldrig** user-agent-sniffing.
- Tilpas layoutet efter det **tilgængelige viewport** (bredde *og* højde) — ikke efter enhedstype
  eller skærmretning alene.
- Understøt ydre og indre skærm, stående og liggende, delte vinduer og ændring af vinduesstørrelse.
- Respektér safe areas (`env(safe-area-inset-*)`) og browserens systemstyrede brugerflade.
- Vigtig navigation og primære handlinger skal være tilgængelige ved den smalleste bredde og den
  laveste højde. Ingen sidelæns rulning (beslutning D-55a2af).
- Foldnings-API'er kun med feature detection og en brugbar fallback:

  ```css
  /* Grundlayout virker overalt. Folden er en forbedring ovenpå. */
  @media (horizontal-viewport-segments: 2) {
    .layout { grid-template-columns: env(viewport-segment-width 0 0) 1fr; }
  }
  @media (device-posture: folded) { /* fx bog-tilstand */ }
  ```

  ```js
  if ("devicePosture" in navigator) {
    navigator.devicePosture.addEventListener("change", () => applyPosture(navigator.devicePosture.type));
  }
  const segments = window.viewport?.segments; // array af DOMRect, eller undefined
  ```

- Brug kun fold-bevidst layout hvor det giver en konkret brugerfordel (fx liste | detalje på hver
  sin side af folden).

## Arkitekturprincip

Én responsiv kodebase. Ingen separate PWA-versioner til iPhone Duo eller andre foldetelefoner.
Enhedsspecifikke foldefunktioner tilføjes kun hvor de giver en konkret brugerfordel, og altid med
en brugbar fallback.

## Testtjekliste (før handoff)

Med Cardmem Lens, kritiker slået til — ved **382 bred**, **951 bred**, **368 høj** og flådens **393px**:

- [ ] Appen fungerer på en smal ydre skærm.
- [ ] Appen udnytter en bred indre skærm hensigtsmæssigt.
- [ ] Navigation og primære handlinger er tilgængelige i alle layouts.
- [ ] Intet kritisk element skjules eller klippes ved ændret viewport.
- [ ] Layoutet reagerer korrekt på ændret retning og vinduesstørrelse.
- [ ] Safe areas og browserens brugerflade respekteres.
- [ ] Appen fungerer når foldnings-API'erne ikke findes.
- [ ] Kritiske flows er testet i Safari (Lens `engine:"webkit"`).

> Lens kan måle bredder og højder, men ikke en rigtig fold eller en ægte iPhone Duo. Fold-tilstanden
> (`device-posture`, segmenter) kan kun bevises på en fysisk enhed eller med feature flags slået til —
> skriv «ikke verificeret på enhed», når det ikke er gjort.

## Instruktion til coding agents

> All PWAs must support iPhone Duo, other foldable/flip phones, and Safari's changing viewport sizes.
>
> - Use responsive CSS with mobile-first layouts, CSS Grid, Flexbox and fluid sizing.
> - Never hardcode device dimensions or identify devices using user-agent sniffing.
> - Adapt layouts to the available viewport (width and height), not the physical device or orientation alone.
> - Support outer and inner displays, portrait, landscape, split-window layouts and resizing.
> - Respect safe areas and system-controlled browser UI.
> - Keep essential navigation and actions accessible at narrow widths and short heights.
> - Use the Device Posture API and Viewport Segments API only with feature detection and appropriate fallbacks.
> - Test all critical flows at narrow and wide viewport sizes, including folded and unfolded layouts where applicable.

## Vigtig bemærkning

Understøttelsen i browserne ændrer sig over tid. Tjek altid den aktuelle WebKit- og
MDN-dokumentation, før du bygger på et bestemt foldnings- eller viewport-API. En
forhåndsvisnings-funktion må aldrig blive en forudsætning for appens grundfunktion.
