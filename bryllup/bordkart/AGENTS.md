# Arbeidsregler for bordkartet

Les `ARBEIDSNOTATER.md` før du endrer filer i denne mappen.

## Om siden

- Dette er en statisk GitHub Pages-side uten byggesteg.
- `index.html` er den publiserte stolplanen.
- `print.html` er utskriftssiden og mottar aktiv bordløsning fra `index.html`.
- `index.html` har valgene `Miks venner` og `Før miks`, samt avkrysningsboksen `Uten kanskje`. Dette gir fire kombinasjoner; `Miks venner` uten avkrysning er standard.
- Brukeren kan bytte mellom `Kart` og `Flat liste`; begge visninger skal bruke samme aktive borddata.
- Behold den publiserte ruten `/bryllup/bordkart/`.
- Den gamle ruten `/bordplassering/` skal videresende hit.
- Hold `index.html`, `bordfordeling.md` og `arbeidsutkast.md` synkronisert.

## Faste begrensninger

- Bord 1-4 er låst med mindre brukeren uttrykkelig låser dem opp.
- Alle par skal sitte ved siden av hverandre.
- Bevar alle spesielle nabokrav i `ARBEIDSNOTATER.md`.
- Bordene er runde og har 8-12 plasser; 10 er optimalt.
- Bruk nøytrale bordoverskrifter. Ikke bruk personnavn som gruppenavn.
- Ikke legg forklarende kommentarer under borddiagrammene.
- Det stiplede feltet til høyre er den eneste sonen for danseplatt og fri ferdsel.
- Foto og film skal sitte ved bord 7, som skal stå lengst unna scenen.

## Utskrift og visuell kontroll

- Behold `@page` som liggende A4.
- Den dedikerte utskriftssiden skal vise ett valgt bord per A4-ark.
- Romoversikten skal stå på en egen side.
- Utskriftsknappen skal ikke vises på utskrift.
- Utskriftssiden skal bruke A4-portrett og la brukeren velge ett bord om gangen. Bare valgt bord skal skrives ut, med fet bordtittel og ett navn per linje.
- `Skriv ut alle` skal skrive ut alle åtte bord med ett eksplisitt A4-sideskift mellom hvert bord.
- Dancing Script er standardfont på utskriftssiden, men fonten skal kunne velges før utskrift.
- Utskriftsstørrelsen kan velges som Liten, Medium, Large eller Extra large; Medium er standard, og bordtittelen skal alltid være større og fetere enn navnene.
- Utskriftsnavn skal være rene fornavn uten spørsmålstegn eller parenteserte roller/identifikatorer.
- Kontroller desktop, mobil og utskriftsvisning i nettleseren etter visuelle endringer.
- Kontroller at ingen navn overlapper eller klippes.

## Datakontroll

- Gjeldende total er 80 personer, inkludert to usikre gjester: Lars og Julie.
- Allergier og kosthensyn skal alltid vises ved personens bord og i den samlede listen nederst.
- Allergivisningene på hovedsiden skal vise personens bord- og plassnummer fra aktiv løsning.
- Utskriftssiden skal ikke vise allergier eller kosthensyn.
- Alle HTML-ID-er for personer skal være unike.
- Kontroller totalsum per bord og samlet total etter hver gjesteendring.
- Kontroller alle fire kombinasjoner etter endringer i gjester, bordnumre eller stolrekkefølge.
- Kontroller både kart- og listevisning etter endringer.
- Kontroller alle par og spesielle naboskap etter endringer i stolrekkefølgen.
- Oppdater totalsum og avbudsberegninger dersom gjestelisten endres.

## Publisering

- Ikke bygg eller generer siden; GitHub Pages serverer `index.html` direkte.
- Ikke commit eller push uten uttrykkelig beskjed.