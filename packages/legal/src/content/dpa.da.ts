import type { DocumentSource } from "../types.js";

export const DPA_DA: DocumentSource = {
  doc: "dpa",
  locale: "da",
  title: "Databehandleraftale",
  version: "2026-11-01",
  effectiveFrom: "2026-11-01",
  material: true,
  draft: true,
  sections: [
    {
      id: "parter",
      heading: "Parter",
      blocks: [
        { id: "parter.p1", type: "p", text: "Den dataansvarlige: {customer.name}, CVR {customer.cvr}, {customer.address}." },
        { id: "parter.p2", type: "p", text: "Databehandleren: {provider.name}, CVR {provider.cvr}, {provider.address}." },
        { id: "parter.p3", type: "p", text: "Aftalen er indgået den {contract.date} og hører til aftalen «{contract.title}»." },
      ],
    },
    {
      id: "formaal",
      heading: "§ 1 Baggrund og formål",
      blocks: [
        { id: "formaal.p1", type: "p", text: "Databehandleren behandler personoplysninger på vegne af den dataansvarlige for at levere de ydelser, parterne har aftalt. Aftalen sikrer, at behandlingen sker i overensstemmelse med databeskyttelsesforordningen (GDPR) og databeskyttelsesloven." },
      ],
    },
    {
      id: "instruks",
      heading: "§ 2 Behandling efter instruks",
      blocks: [
        { id: "instruks.p1", type: "p", text: "Databehandleren behandler kun personoplysninger efter dokumenteret instruks fra den dataansvarlige, medmindre andet følger af EU-ret eller dansk ret. Er en instruks efter databehandlerens opfattelse i strid med reglerne, underrettes den dataansvarlige straks." },
      ],
    },
    {
      id: "fortrolighed",
      heading: "§ 3 Fortrolighed",
      blocks: [
        { id: "fortrolighed.p1", type: "p", text: "Kun personer, der har brug for det for at levere ydelsen, får adgang til personoplysningerne, og de er underlagt tavshedspligt." },
      ],
    },
    {
      id: "sikkerhed",
      heading: "§ 4 Behandlingssikkerhed",
      blocks: [
        { id: "sikkerhed.p1", type: "p", text: "Databehandleren træffer passende tekniske og organisatoriske foranstaltninger efter GDPR art. 32, herunder kryptering under overførsel og opbevaring, adgangsstyring, logning af adgang, sikkerhedskopier og en plan for sikkerhedshændelser." },
      ],
    },
    {
      id: "underdatabehandlere",
      heading: "§ 5 Underdatabehandlere",
      blocks: [
        { id: "underdatabehandlere.p1", type: "p", text: "Den dataansvarlige giver generel godkendelse til de underdatabehandlere, der er anført nedenfor. Databehandleren varsler ændringer mindst 14 dage før, og den dataansvarlige kan gøre indsigelse. Underdatabehandlere pålægges de samme forpligtelser som i denne aftale." },
        { id: "underdatabehandlere.facts", type: "facts", fact: "subprocessors" },
      ],
    },
    {
      id: "tredjelande",
      heading: "§ 6 Overførsel til tredjelande",
      blocks: [
        { id: "tredjelande.p1", type: "p", text: "Overførsel til lande uden for EU/EØS sker kun med et gyldigt overførselsgrundlag efter GDPR kapitel V." },
      ],
    },
    {
      id: "bistand",
      heading: "§ 7 Bistand til den dataansvarlige",
      blocks: [
        { id: "bistand.p1", type: "p", text: "Databehandleren bistår den dataansvarlige med at opfylde de registreredes rettigheder og med sikkerhed, konsekvensanalyser og forhåndshøringer, i det omfang det er relevant for ydelsen." },
      ],
    },
    {
      id: "brud",
      heading: "§ 8 Brud på persondatasikkerheden",
      blocks: [
        { id: "brud.p1", type: "p", text: "Databehandleren underretter den dataansvarlige uden unødig forsinkelse og senest 24 timer efter at være blevet bekendt med et brud, med de oplysninger den dataansvarlige skal bruge til at anmelde det." },
      ],
    },
    {
      id: "produktanalyse",
      heading: "§ 9 Analyse for at forbedre databehandlerens produkter",
      blocks: [
        { id: "produktanalyse.p1", type: "p", text: "Databehandleren må bruge oplysningerne pseudonymiseret til at analysere og forbedre sine produkter: brug af produkterne, strukturen i henvendelser og anonyme opgørelser for grupper på mindst 10 personer. Den pseudonymiserede analysekopi gemmes højst 6 måneder. Til dette formål er databehandleren selvstændigt dataansvarlig." },
        { id: "produktanalyse.p2", type: "p", text: "Helbredsoplysninger og andre særlige kategorier indgår kun, hvis den registrerede udtrykkeligt har givet samtykke." },
        { id: "produktanalyse.p3", type: "p", text: "Den dataansvarlige kan til enhver tid modsætte sig denne analyse skriftligt. Indsigelsen gælder fra modtagelsen. Undtagelser herfra aftales kun i en særskilt kontrakt." },
        { id: "produktanalyse.p4", type: "p", text: "Den dataansvarlige oplyser sine egne brugere om analysen i sin privatlivspolitik. Afsnittet nedenfor kan bruges uændret:" },
        { id: "produktanalyse.note", type: "note", text: "«Vores leverandør, {provider.name}, analyserer pseudonymiserede oplysninger om brugen af løsningen for at forbedre sine produkter. Navne og andre direkte kendetegn fjernes eller erstattes først, helbredsoplysninger indgår kun med dit udtrykkelige samtykke, og analysekopien gemmes højst 6 måneder. Du kan gøre indsigelse ved at kontakte os.»" },
      ],
    },
    {
      id: "ophoer",
      heading: "§ 10 Sletning og tilbagelevering",
      blocks: [
        { id: "ophoer.p1", type: "p", text: "Ved aftalens ophør sletter eller tilbageleverer databehandleren efter den dataansvarliges valg alle personoplysninger, medmindre lovgivningen kræver opbevaring. Sikkerhedskopier slettes inden for 90 dage." },
      ],
    },
    {
      id: "revision",
      heading: "§ 11 Revision og inspektion",
      blocks: [
        { id: "revision.p1", type: "p", text: "Databehandleren stiller de oplysninger til rådighed, der er nødvendige for at påvise overholdelse af aftalen, og giver mulighed for revision efter rimeligt varsel." },
      ],
    },
    {
      id: "varighed",
      heading: "§ 12 Ikrafttrædelse, varighed og lovvalg",
      blocks: [
        { id: "varighed.p1", type: "p", text: "Aftalen gælder, så længe databehandleren behandler personoplysninger for den dataansvarlige. Aftalen er underlagt dansk ret, og tvister afgøres ved de danske domstole. Den danske udgave gælder ved forskel til en oversættelse." },
      ],
    },
  ],
};
