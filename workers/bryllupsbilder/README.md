# Opplasting av bryllupsbilder

Gjestene laster opp fra GitHub Pages uten GitHub-konto. En Cloudflare Worker
validerer forespørselen og sender bildet videre som en asset i en GitHub Release.
GitHub-tokenet finnes bare som en Worker-hemmelighet.

Oppsettet kan hostes gratis for normal bruk i et bryllup:

- GitHub Pages hoster nettsiden gratis.
- Et privat GitHub-repo lagrer Release-assetene gratis.
- Cloudflare Workers Free håndterer opplastingene. Gratisnivået har en daglig
   grense, men den er langt høyere enn forventet trafikk fra et bryllup.
- Gjestene trenger ingen konto eller kode. Alle som har lenken kan laste opp fra
   en vanlig mobil- eller desktopnettleser.

Cloudflare- og GitHub-konto kreves bare av den som setter opp løsningen.
Worker-en begrenser automatisk antall opplastinger per nettleser og per
Cloudflare-lokasjon. Gjestene trenger ikke gjøre noe for denne kontrollen.
På mobil begrenses bildeforhåndsvisningen til 250 piksler. Etter bildevalg får
navnefeltet fokus og scrolles mykt til midten av skjermen, slik at navn og
opplastingsknapp er tilgjengelige uten manuell scrolling.
Alle opplastede bilder vises med 10 piksler avrundede hjørner i
forhåndsvisning, administrasjon, slideshow, spotlight og returanimasjon.
Gjestene kan også skrive en valgfri hilsen på inntil 140 tegn. Navn og hilsen
lagres i GitHub Release-assetens `label` som metadata, for eksempel
`Hilsen fra Kari: Gratulerer med dagen!`. Worker-en returnerer dette som egne
`author`- og `greeting`-felt. Kontrolltegn fjernes før lagring, og eksisterende
`Bilde fra …`-labels uten hilsen støttes fortsatt.

## 1. Opprett lagringsstedet

1. Opprett et eget **privat** GitHub-repo, for eksempel
   `bryllupsbilder-2026`. Ikke bruk nettsiderepoet; mange binærfiler gjør
   Git-historikken unødvendig stor.
2. Opprett en Release i bilderepoet, for eksempel med taggen `bryllup-2026`.
3. Finn den numeriske Release-ID-en:

   ```sh
   gh api repos/haavamoa/bryllupsbilder-2026/releases/tags/bryllup-2026 --jq .id
   ```

En GitHub Release kan ha opptil 1000 assets. Opprett en ny Release og bytt
`GITHUB_RELEASE_ID` dersom det skulle bli behov for flere.

## 2. Opprett et avgrenset GitHub-token

Opprett et fine-grained personal access token i GitHub:

- Gi tokenet tilgang til bare det private bilderepoet.
- Sett `Contents` til `Read and write`.
- Velg en kort utløpsdato etter bryllupet.

Ikke legg tokenet i denne mappen, GitHub Pages eller `wrangler.toml`.

## 3. Konfigurer og publiser Worker-en

Bytt ut verdiene for `GITHUB_OWNER`, `GITHUB_REPO` og `GITHUB_RELEASE_ID` i
`wrangler.toml`. Kjør deretter fra denne mappen:

```sh
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

Rate limiting-bindingene i `wrangler.toml` tillater 10 opplastingsforsøk per
nettleser og 100 totalt per Cloudflare-lokasjon per minutt. De bruker to unike
numeriske namespace-ID-er og opprettes sammen med Worker-en ved publisering.

## 4. Koble til nettsiden

Etter publisering viser Wrangler en adresse som ligner:

```text
https://bryllupsbilder.<cloudflare-konto>.workers.dev
```

Sett denne adressen med `/upload` i `meta[name="upload-endpoint"]` i
`bryllup/bilder/index.html` og publiser GitHub Pages-siden.

Ved lokal testing må den lokale origin-en midlertidig legges til som en
kommaseparert verdi i `ALLOWED_ORIGINS`, for eksempel
`https://haavamoa.github.io,http://localhost:8000`.

## 5. Konfigurer privat bildeoversikt

Administrasjonssiden ligger på:

```text
https://haavamoa.github.io/bryllup/bilder/admin/
```

Den bruker GitHub OAuth kun til å bekrefte identiteten. OAuth-tokenet brukes
ikke til bilderepoet og sendes aldri til administrasjonssiden. Worker-en gir
kun tilgang når GitHub-brukernavnet matcher `ADMIN_GITHUB_LOGIN`.

1. Gå til GitHub **Settings → Developer settings → OAuth Apps** og velg
   **New OAuth App**.
2. Fyll inn:

   ```text
   Application name: Bryllupsbilder administrasjon
   Homepage URL: https://haavamoa.github.io/bryllup/bilder/admin/
   Authorization callback URL: https://bryllupsbilder.bryllupsbilder.workers.dev/auth/callback
   ```

3. Kopier **Client ID** inn som `GITHUB_OAUTH_CLIENT_ID` i `wrangler.toml`.
4. Opprett en **Client secret** i OAuth App-en og registrer den direkte i
   Cloudflare:

   ```sh
   npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
   ```

5. Opprett en tilfeldig signeringsnøkkel på minst 32 tegn og registrer den:

   ```sh
   npx wrangler secret put ADMIN_SESSION_SECRET
   ```

6. Publiser den oppdaterte Worker-en:

   ```sh
   npx wrangler deploy
   ```

Adminøkten varer i 18 timer, oppbevares i nettleserfanens `sessionStorage`
og fjernes ved utlogging eller når fanen lukkes. Bilder vises gjennom en
autorisert Worker-proxy. Sletting kontrollerer at bildet tilhører den
konfigurerte Release-en før GitHub-asseten fjernes permanent.

### Visning på skjerm i festlokalet

Etter innlogging kan **Vis på skjerm** velges fra bildeoversikten. Nettleseren
går i fullskjerm og viser et tilfeldig slideshow som skifter hvert tolvte
sekund. Landskapsbilder og kvadratiske bilder vises alltid alene, mens to
portrettbilder kan vises ved siden av hverandre. Bildene ligger direkte på
bakgrunnen uten ramme eller egen flate. Neste lag lastes ferdig før det
kryssfades inn over 1,8 sekunder, så bakgrunnen blir aldri blank.
Hvert motiv får en eksplisitt contain-størrelse beregnet fra naturlig
bildeformat og tilgjengelig flis. Den avrundede wrapperen følger derfor selve
motivet, og ingen overgangstilstand kan skalere bildet utenfor slideshowflaten.
Ved layoutbytte fader gammel komposisjon helt ut og fjernes før neste fader inn.
Det finnes derfor aldri bilder fra to forskjellige layouts samtidig.

Listen oppdateres hvert åttende sekund. Et nytt bilde settes inn på en tilfeldig
plass i slideshowkøen og løftes samtidig frem over den pågående bakgrunnen i
20 sekunder. Introduksjonen bruker hjerter, gifteringer, norske flagg,
brudepar, blomster eller skåling. Hvert bilde får én tilfeldig tematikk, slik at
flagg, ringer og blomster ikke blandes i samme effekt. Deretter animeres bildet
inn i en slideshowkomposisjon, og eventuelle flere nye bilder behandles i kø.
Effektene popper frem i ledig plass ved siden av eller under motivet og faller
deretter ut av nettleservinduet uten å dekke bildet. Hele motivet vises uten
hvite felt rundt portrettbilder.

Hvis bildet har en hilsen, vises den også i adminoversikten og som en ticker i
den nederste raden på festskjermen. Footeren flyttes automatisk over hilsenen,
og bildeområdet blir tilsvarende lavere slik at teksten aldri dekker motivet.
Når et nytt bilde står i spotlight, prioriteres dette bildets hilsen. I
slideshowet vises hilsenen til hvert synlige bilde sekvensielt; ved to
portrettbilder ruller første hilsen ferdig, deretter andre. Avsenderen vises
etter hilsenen. Tickerens varighet tilpasses tekstlengden mellom 9 og 17
sekunder, og slideshowet bytter først etter at alle hilsener i komposisjonen er
ferdige. Tickerbakgrunnen er helt ugjennomsiktig, slik at bakgrunnsmønster,
slideshow og lyskastere ikke skinner gjennom teksten.

**Party mode** slås av og på med en diskret switch i festskjermens topplinje.
Modusen fader inn en sakte bevegelig bakgrunn med flere diskofarger samtidig,
gir bildene neonglød og legger til egne tilfeldige temaer med diskokule, dans,
musikk, festkonfetti og neonlys. «Ida & Håvard» skifter mykt mellom tilfeldige,
lesbare festfarger hvert 2,8–5,2 sekund. Valget lagres lokalt i nettleseren og
gjenbrukes neste gang visningen åpnes. Den ytterste rammen har 14 piksler
avrundede hjørner. Mellom bildehendelsene dukker enkelte partyemoji tilfeldig
opp og flyr tvers over, svever opp eller popper inn og driver bort. Frekvensen
og antallet holdes lavt, med omtrent 4–9 sekunder mellom hver effekt og sjelden
mer enn én samtidig. Alle ambient-effekter stoppes og fjernes når party mode
slås av.

Party mode sender også sporadisk én eller to myke lyskasterkjegler over hele
festskjermen, inkludert topplinje, slideshow og footer.
Lysene velger tilfeldig mellom cyan, blått, lilla, magenta, grønt og gull, og
sveiper i ulik retning over 5–9 sekunder før de fader ut. `screen`-blending og
moderat opacity gjør lysene synlige uten å vaske ut motivene. Lyskasterne har
sin egen tilfeldige rytme og fjernes umiddelbart når party mode slås av.

Polling sammenligner den mottatte bildelisten med forrige resultat. Når listen
er uendret, berøres verken bildeveggen, DOM-elementene eller den lokale
bildecachen. Skjermen oppdateres derfor bare når et bilde faktisk er lagt til,
fjernet eller endret.

Visningen bruker samme private adminøkt og offentliggjør ingen bilde-URL-er.
Velg **Avslutt visning** for å gå tilbake til administrasjon og sletting.

## Etter bryllupet

Last ned Release-assetene, deaktiver Worker-en og slett GitHub-tokenet. Bildene
forblir private i bilderepoet så lenge repoet er privat.