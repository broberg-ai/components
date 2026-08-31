# Selen, ikke agenten

## Hvordan vi bygger store, komplekse systemer hurtigt — ved at gå ud fra at vores agenter tager fejl

**Dansk udgave · skrevet af `components`-sessionen, 31-08-2026 · til `cms` at lande**

---

Hos broberg.ai skrives stort set al produktionskode af AI-agenter. Ikke assisteret,
ikke autofuldført — skrevet. Ét menneske sætter retningen; agenterne bygger,
reviewer, udruller og drifter. Den arbejdsform producerer software i et tempo, der
tidligere krævede et helt team, på tværs af en række systemer i drift: kommunal
sundhedsdrift, klinikbooking og betalinger, et fælles bibliotek på 45 udgivne
npm-pakker, en observabilitetsplatform, et projektstyringssystem, en motor til
visuel verifikation.

Det oplagte spørgsmål er også det rigtige: **hvordan kan man stole på noget af det?**

Svaret er ikke det, folk forventer. Vi påstår ikke, at vores agenter ikke laver
fejl. De laver dem hele tiden — og det gør vi andre også. Det, vi bygger,
bevidst og løbende og som en del af selve produktet, er **selen**: det maskineri,
der fanger en fejl, før den når nogen, der ville lide under den.

Forskellen er afgørende, for kun den ene af de to påstande overlever mødet med
virkeligheden.

---

## En regel er en påmindelse. En spærre er en mekanisme.

I begyndelsen gjorde vi, hvad alle gør: vi skrev reglerne ned. Påstå aldrig, at
noget virker, uden bevis. Omgå aldrig en fejlende test. Læs værdien tilbage fra
databasen, før du siger, at den blev gemt.

Nedskrevne regler er nødvendige, og de er ikke tilstrækkelige — af en grund, der
intet har med AI at gøre: **en regel afhænger af, at nogen husker den præcis i det
øjeblik, hvor de har travlt.** Vores egen interne kontrakt siger det nu på én
linje: *en spærre afhænger ikke af, at en agent husker noget.*

Derfor er hver regel, der betyder noget, oversat til noget mekanisk:

- En **commit-spærre**, der nægter at gemme en adgangsnøgle — ikke ved at bede
  agenten være omhyggelig, men ved at scanne ændringen og afvise den.
- En **udgivelses-spærre**, hvor udrulningen afhænger af testene, så én rød test
  blokerer udgivelsen i stedet for at give en advarsel, nogen scroller forbi.
- **Accept-kriterier som data**, hæftet på opgaven, hvor hvert enkelt kræver et
  bevis — et måleresultat, en værdi, et skærmbillede — før det kan hakkes af.
- En **review-port**, der ikke lader arbejde blive markeret færdigt, før kodereview,
  sikkerhedsreview, visuel verifikation og kriterierne alle er registreret grønne,
  med beviset gemt ved siden af resultatet.

Intet af det er eksotisk. Det usædvanlige er at behandle selen som produktet
frem for som spildtid — og at blive ved med at investere i den hver eneste uge,
fordi fejlformerne udvikler sig.

---

## Spærren, der blokerede sin egen oprydning

Her er et virkeligt eksempel fra den uge, dette blev skrevet, og det er godt
netop fordi det får os til at se ufuldkomne ud.

Vores commit-spærre scanner enhver ændring for noget, der ligner en adgangsnøgle.
Den virker. Den har fanget rigtige nøgler.

Så forsøgte en agent at slette et forældet dokument, som tilfældigvis citerede en
offentlig eksempel-nøgle fra en leverandørs egen dokumentation — og commit'en blev
afvist. Spærren læste hele ændringen, både tilføjelser og **sletninger**. Så den
commit, hvis eneste formål var at *fjerne* nøglen, var den ene, den ikke ville
tillade.

Vagten forhindrede præcis den oprydning, den findes for at fremtvinge. Og den
eneste udvej, den efterlod, var det ene, man aldrig må gøre ved en spærre: slå
den fra.

Rettelsen tog en time. Det interessante er ikke rettelsen, men formen:

- Fejlen blev fundet **af spærren, mens den gjorde sit arbejde** — ikke ved en
  gennemgang.
- Rettelsen blev bevist ved først at skrive en test, der **fejlede** mod den gamle
  adfærd, i begge scanningslag.
- Testen blev derefter **muteret**: den gamle adfærd blev bevidst genindført, og
  testen *skulle* blive rød. Derefter blev rettelsen svækket til slet ikke at
  scanne noget, og en anden test skulle blive rød. En test, der ikke kan fejle, er
  pynt.
- Undervejs viste testen sig at være **grøn af den forkerte grund** — den blev
  stoppet af et helt andet lag, så den kontrol, den påstod at udføre, aldrig kørte.
- Og den første mutation **genindførte slet ikke fejlen**, hvilket maskineriet
  meldte i stedet for stiltiende at bestå.

Fem ting gik galt i en rettelse på en time. Ingen af dem nåede en bruger. Det
forhold er produktet.

---

## Agenter, der reviewer hinanden — og ikke tager hinandens ord for noget

Den anden halvdel af selen er ikke kode. Det er en arbejdsform mellem sessionerne.

Hvert repo har sin egen langtidskørende agent. De taler direkte sammen — det
fælles bibliotek, de systemer der bruger det, flåde-daemonen, projektstyringen. Og
husreglen mellem dem er kontant: **mål det, tag det aldrig på ord.**

På én aften i den her uge producerede den arbejdsform følgende — alt sammen mellem
agenter, uden et menneske indblandet:

- En session meldte, at en delt pakke angav forkert dataplacering: den svarede
  "ukendt" i stedet for "EU" for netop den leverandør, vi sender persondata til.
  Den fejlede til den *sikre* side, så ingen data forlod EU; men en app, der
  håndhæver EU-krav, ville have afvist sit eget lovlige kald. Rettet inden for en
  time — og derefter verificeret af en anden session, der installerede begge
  udgivne versioner og sammenlignede det, der faktisk blev leveret, i stedet for
  at stole på meldingen.
- Den verifikation fandt **endnu en** fejl i selve rettelsen: den funktion, alle
  blev henvist til som den sikre, havde samme fejl ét skridt til venstre.
- To sessioner var derefter uenige om en tredje pakkes opførsel — begge med
  målinger i hånden. Uenigheden viste sig at *være* fundet: de målte hver sin
  udgivne version, og den nyeste havde flyttet en regel ud af den dokumenterede
  liste uden at ændre adfærden. Enhver, der gennemgik pakken på den dokumenterede
  måde, ville konkludere, at reglen var væk. Det var den ikke.
- En forbruger afslog en funktion, vi tilbød dem, med et bedre argument end det, vi
  selv havde brugt til at bygge den: *retten til at modtage et usikkert svar
  tilhører den, der kan vise usikkerheden.* Deres flade viser en værdi som en
  kendsgerning, så et gæt bliver stiltiende til en påstand. De tog det tomme svar
  i stedet.

Hver eneste af dem er en fejl, der ellers var blevet fundet af en kunde — eller
slet ikke. Ingen af dem blev fundet af et menneske, der læste kode.

---

## Fejlen, vi bliver ved med at finde — og hvordan vi jager den nu

På tværs af mange hændelser går én form igen så ofte, at vi nu navngiver den
eksplicit i vores tekniske dokumenter: **et resultat, der er formet som en succes,
men i virkeligheden er et ikke-svar.**

- Et mailsystem, der svarede "ok" af fire forskellige grunde — hvoraf den ene var
  "sendte ingenting".
- Et modelopslag, der svarede "ok" for en model, det aldrig havde hørt om, og gav
  kalderens eget input tilbage, som var det et svar.
- En vidensbase, der ikke kunne skelne "fandt ingenting" fra "kunne ikke nås" — så
  med kilden nede besvarede den sundhedsspørgsmål ud fra generisk viden, i en
  fagpersons stemme.
- En måling, der meldte "0 af 39 mønstre matcher", fordi feltnavnet var gættet
  forkert — og et forkert feltnavn og et ægte fravær giver samme værdi.

Kuren generaliserer og er nu fast praksis: **gør de to tilstande adskillelige, og
forbyd derefter den uadskillelige form strukturelt.** I praksis betyder det, at en
funktion melder, hvilke kontroller den overhovedet kunne udføre — ikke kun hvad
den fandt. Det betyder, at en undtagelse i koden skal bære en skreven begrundelse,
som aldrig læses ved kørsel og kun findes for at gøre en *tavs* undtagelse umulig
at skrive. Og det betyder en strukturel test, der læser listen over tilladte
undtagelser ud af sandhedskilden i stedet for at gentage den — og som udskriver
den konkrete linje frem for et antal, fordi et antal ikke fortæller den næste
læser, hvor han skal kigge.

Den beslægtede disciplin: **stol aldrig på et grønt resultat fra en kontrol, du
ikke har set fejle.** Bevis det røde først. Ellers ligner en kontrol, der stille er
holdt op med at teste noget som helst, præcis en kontrol, der består.

---

## Vi optimerer menneskets opmærksomhed, ikke maskinens tid

Den seneste ændring af selen kom fra en enkelt sætning fra den person, det hele
tjener.

Vi havde målt, at flådens sessioner brugte mange timer på at køre udrulninger i
forgrunden — hvor en session ikke kan svare. Vi byggede en spærre, der skubber
langvarigt arbejde i baggrunden, hvor det kører videre på tværs af ture, vækker
agenten når det er færdigt, og stadig returnerer den fejlkode, der gør en
udrulning *bevist* frem for antaget.

Så kom rettelsen, og den vendte målestokken om: *det er ikke agenten, der spilder
tid — det er mig.* En session, der venter, mister ingenting. Det, det koster, er,
at den der orkestrerer flåden, ikke kan komme til at tale med en af sine agenter.

Altså er enheden ikke sekunder, men **afbrydelser**. En tyve minutters udrulning
klokken tre om natten, hvor ingen venter, koster nul. To minutters tavshed midt i
en samtale koster to minutter — og oplevelsen af at blive ignoreret. Den ene
ændring af nævneren ugyldiggjorde den grænse, vi lige havde udledt, og målingen
blev kørt om på den rigtige enhed, før noget blev udgivet.

Da den var kørt om, viste den noget, ingen af os havde gættet: hvor ofte han
faktisk sad der, var **det samme** for korte og lange ventetider. Og de korte
ventetider — median atten sekunder — blev bevidst holdt uden for spærren, fordi en
tur frem og tilbage til baggrunden koster mere, end den sparer, og ville gøre hans
samtaler *langsommere*. Den tid lades ligge med vilje.

Det er hele metoden i én historie: byg det, mål det, lad den person det tjener
fortælle dig, at du målte det forkerte — og gå i gang igen.

---

## Hvad det køber

Volumen og kompleksitet, der ellers ville kræve et team, med en fejlrate der
falder i stedet for at stige, efterhånden som systemerne vokser. Ikke fordi
agenterne holdt op med at tage fejl — i den her uge alene tog de fejl om et
regulært udtryk, en EU-mærkning, en test der bestod af den forkerte grund, og en
mutation der ikke muterede.

Men fordi hver eneste af dem blev fanget af noget, der var bygget til at fange den.

**Vi påstår ikke, at vores software er fejlfri. Vi påstår, at de interessante fejl
bliver fundet af vores eget maskineri, som regel inden for en time — og at
maskineriet bliver bedre hver uge, fordi det at bygge det behandles som det
egentlige arbejde og ikke som spildtiden omkring det.**

For et lille firma, der leverer systemer, kommuner og klinikker er afhængige af,
er det et mere brugbart løfte end perfektion. Det er også det eneste, der bliver
ved med at være sandt.
