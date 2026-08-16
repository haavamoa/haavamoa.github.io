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

## Etter bryllupet

Last ned Release-assetene, deaktiver Worker-en og slett GitHub-tokenet. Bildene
forblir private i bilderepoet så lenge repoet er privat.