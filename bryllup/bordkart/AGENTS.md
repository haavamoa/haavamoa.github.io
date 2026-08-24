# Arbeidsregler for bordkartet

Les `ARBEIDSNOTATER.md` før du endrer filer i denne mappen.

## Om siden

- Dette er en statisk GitHub Pages-side uten byggesteg.
- `index.html` er den publiserte stolplanen.
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
- Foto og film skal sitte ved bord 8, som skal stå lengst unna scenen.

## Utskrift og visuell kontroll

- Behold `@page` som liggende A4.
- Behold to bord i bredden på hver detaljside.
- Romoversikten skal stå på en egen side.
- Utskriftsknappen skal ikke vises på utskrift.
- Kontroller desktop, mobil og utskriftsvisning i nettleseren etter visuelle endringer.
- Kontroller at ingen navn overlapper eller klippes.

## Datakontroll

- Gjeldende total er 80 personer, inkludert fire usikre gjester.
- Alle HTML-ID-er for personer skal være unike.
- Kontroller totalsum per bord og samlet total etter hver gjesteendring.
- Kontroller alle fire kombinasjoner etter endringer i gjester, bordnumre eller stolrekkefølge.
- Kontroller både kart- og listevisning etter endringer.
- Kontroller alle par og spesielle naboskap etter endringer i stolrekkefølgen.
- Oppdater totalsum og avbudsberegninger dersom gjestelisten endres.

## Publisering

- Ikke bygg eller generer siden; GitHub Pages serverer `index.html` direkte.
- Ikke commit eller push uten uttrykkelig beskjed.