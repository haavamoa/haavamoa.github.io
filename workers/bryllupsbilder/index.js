const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/auth/github") {
      return beginGithubLogin(env);
    }

    if (request.method === "GET" && url.pathname === "/auth/callback") {
      return finishGithubLogin(url, env);
    }

    const origin = request.headers.get("Origin") ?? "";
    const allowedOrigin = getAllowedOrigin(origin, env.ALLOWED_ORIGINS);
    const corsHeaders = getCorsHeaders(allowedOrigin);

    if (request.method === "OPTIONS") {
      if (!allowedOrigin) {
        return jsonResponse({ error: "Ugyldig opprinnelse." }, 403);
      }

      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!allowedOrigin) {
      return jsonResponse({ error: "Ugyldig opprinnelse." }, 403);
    }

    if (url.pathname.startsWith("/admin/")) {
      return handleAdminRequest(request, url, env, corsHeaders);
    }

    if (request.method !== "POST" || url.pathname !== "/upload") {
      return jsonResponse({ error: "Ikke funnet." }, 404, corsHeaders);
    }

    const clientId = request.headers.get("X-Upload-Client") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
      return jsonResponse({ error: "Kunne ikke identifisere nettleseren." }, 400, corsHeaders);
    }

    const [clientLimit, globalLimit] = await Promise.all([
      env.UPLOAD_RATE_LIMITER.limit({ key: clientId }),
      env.GLOBAL_RATE_LIMITER.limit({ key: "wedding-uploads" }),
    ]);
    if (!clientLimit.success || !globalLimit.success) {
      return jsonResponse(
        { error: "Det lastes opp mange bilder akkurat nå. Vent ett minutt og prøv igjen." },
        429,
        { ...corsHeaders, "Retry-After": "60" },
      );
    }

    const missingConfiguration = [
      "GITHUB_OWNER",
      "GITHUB_REPO",
      "GITHUB_RELEASE_ID",
      "GITHUB_TOKEN",
    ].filter((key) => !env[key]);

    if (missingConfiguration.length > 0) {
      console.error(`Mangler Worker-konfigurasjon: ${missingConfiguration.join(", ")}`);
      return jsonResponse({ error: "Opplasting er ikke konfigurert ennå." }, 503, corsHeaders);
    }

    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return jsonResponse({ error: "Bildet er for stort. Maks størrelse er 15 MB." }, 413, corsHeaders);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return jsonResponse({ error: "Kunne ikke lese opplastingen." }, 400, corsHeaders);
    }

    const image = formData.get("image");
    if (!(image instanceof File) || image.size === 0) {
      return jsonResponse({ error: "Velg et bilde først." }, 400, corsHeaders);
    }

    if (image.size > MAX_FILE_BYTES) {
      return jsonResponse({ error: "Bildet er for stort. Maks størrelse er 15 MB." }, 413, corsHeaders);
    }

    const imageType = await detectImageType(image);
    if (!imageType) {
      return jsonResponse(
        { error: "Filtypen støttes ikke. Bruk JPEG, PNG, WebP, HEIC eller AVIF." },
        415,
        corsHeaders,
      );
    }

    const guestName = cleanGuestName(formData.get("name"));
    const date = new Date().toISOString().slice(0, 10);
    const assetName = `bryllup-${date}-${crypto.randomUUID()}.${imageType.extension}`;
    const assetLabel = guestName ? `Bilde fra ${guestName}` : "Bilde fra en gjest";
    const uploadUrl = new URL(
      `https://uploads.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/releases/${encodeURIComponent(env.GITHUB_RELEASE_ID)}/assets`,
    );
    uploadUrl.searchParams.set("name", assetName);
    uploadUrl.searchParams.set("label", assetLabel);

    let githubResponse;
    try {
      githubResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "Content-Type": imageType.contentType,
          "User-Agent": "bryllupsbilder-worker",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: image.stream(),
      });
    } catch (error) {
      console.error("Kunne ikke kontakte GitHub:", error);
      return jsonResponse(
        { error: "Kunne ikke kontakte GitHub. Prøv igjen om litt." },
        502,
        corsHeaders,
      );
    }

    if (!githubResponse.ok) {
      const githubError = await githubResponse.text();
      console.error(`GitHub-opplasting feilet (${githubResponse.status}): ${githubError}`);
      return jsonResponse(
        { error: "GitHub tok ikke imot bildet. Prøv igjen om litt." },
        502,
        corsHeaders,
      );
    }

    return jsonResponse({ message: "Bildet er lastet opp. Tusen takk!" }, 201, corsHeaders);
  },
};

function getAllowedOrigin(origin, configuredOrigins = "") {
  const origins = configuredOrigins
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const normalizedOrigin = origin.replace(/\/$/, "");

  return origins.includes(normalizedOrigin) ? normalizedOrigin : "";
}

function getCorsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Upload-Client",
    "Access-Control-Allow-Methods": "DELETE, GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(""), ...headers },
  });
}

async function beginGithubLogin(env) {
  const configurationError = getAdminConfigurationError(env);
  if (configurationError) return configurationError;

  const state = await createSignedToken(
    { kind: "oauth-state", exp: nowInSeconds() + 10 * 60 },
    env.ADMIN_SESSION_SECRET,
  );
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", env.GITHUB_OAUTH_CALLBACK_URL);
  authorizeUrl.searchParams.set("scope", "read:user");
  authorizeUrl.searchParams.set("state", state);

  return Response.redirect(authorizeUrl.toString(), 302);
}

async function finishGithubLogin(url, env) {
  const configurationError = getAdminConfigurationError(env);
  if (configurationError) return configurationError;

  const state = await verifySignedToken(
    url.searchParams.get("state") ?? "",
    env.ADMIN_SESSION_SECRET,
    "oauth-state",
  );
  if (!state || !url.searchParams.get("code")) {
    return redirectToAdmin(env, "GitHub-innloggingen kunne ikke bekreftes.");
  }

  let tokenResponse;
  try {
    tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "bryllupsbilder-worker",
      },
      body: JSON.stringify({
        client_id: env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
        code: url.searchParams.get("code"),
        redirect_uri: env.GITHUB_OAUTH_CALLBACK_URL,
      }),
    });
  } catch (error) {
    console.error("Kunne ikke kontakte GitHub OAuth:", error);
    return redirectToAdmin(env, "Kunne ikke kontakte GitHub.");
  }

  const tokenResult = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenResult.access_token) {
    console.error("GitHub OAuth avviste innloggingen:", tokenResult);
    return redirectToAdmin(env, "GitHub avviste innloggingen.");
  }

  const userResponse = await githubFetch("https://api.github.com/user", tokenResult.access_token);
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || user.login?.toLowerCase() !== env.ADMIN_GITHUB_LOGIN.toLowerCase()) {
    return redirectToAdmin(env, "Denne GitHub-brukeren har ikke tilgang.");
  }

  const session = await createSignedToken(
    {
      kind: "admin-session",
      login: user.login,
      exp: nowInSeconds() + ADMIN_SESSION_SECONDS,
    },
    env.ADMIN_SESSION_SECRET,
  );

  return Response.redirect(`${env.ADMIN_URL}#session=${encodeURIComponent(session)}`, 302);
}

async function handleAdminRequest(request, url, env, corsHeaders) {
  const configurationError = getAdminConfigurationError(env, corsHeaders);
  if (configurationError) return configurationError;

  const authorization = request.headers.get("Authorization") ?? "";
  const session = await verifySignedToken(
    authorization.replace(/^Bearer\s+/i, ""),
    env.ADMIN_SESSION_SECRET,
    "admin-session",
  );
  if (!session || session.login.toLowerCase() !== env.ADMIN_GITHUB_LOGIN.toLowerCase()) {
    return jsonResponse({ error: "Logg inn med GitHub for å fortsette." }, 401, corsHeaders);
  }

  if (request.method === "GET" && url.pathname === "/admin/assets") {
    const assets = await listReleaseAssets(env);
    if (!assets) {
      return jsonResponse({ error: "Kunne ikke hente bildene fra GitHub." }, 502, corsHeaders);
    }

    return jsonResponse(
      {
        assets: assets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          label: asset.label,
          contentType: asset.content_type,
          size: asset.size,
          createdAt: asset.created_at,
        })),
      },
      200,
      corsHeaders,
    );
  }

  const assetMatch = url.pathname.match(/^\/admin\/assets\/(\d+)(\/content)?$/);
  if (!assetMatch) {
    return jsonResponse({ error: "Ikke funnet." }, 404, corsHeaders);
  }

  const assetId = Number(assetMatch[1]);
  const assets = await listReleaseAssets(env);
  const asset = assets?.find((candidate) => candidate.id === assetId);
  if (!asset) {
    return jsonResponse({ error: "Bildet finnes ikke." }, 404, corsHeaders);
  }

  if (request.method === "GET" && assetMatch[2] === "/content") {
    const imageResponse = await githubFetch(
      `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/releases/assets/${assetId}`,
      env.GITHUB_TOKEN,
      "application/octet-stream",
    );
    if (!imageResponse.ok) {
      return jsonResponse({ error: "Kunne ikke hente bildet fra GitHub." }, 502, corsHeaders);
    }

    return new Response(imageResponse.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": asset.content_type || "application/octet-stream",
      },
    });
  }

  if (request.method === "DELETE" && !assetMatch[2]) {
    const deleteResponse = await githubFetch(
      `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/releases/assets/${assetId}`,
      env.GITHUB_TOKEN,
      "application/vnd.github+json",
      { method: "DELETE" },
    );
    if (!deleteResponse.ok) {
      return jsonResponse({ error: "GitHub kunne ikke slette bildet." }, 502, corsHeaders);
    }

    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return jsonResponse({ error: "Ikke funnet." }, 404, corsHeaders);
}

async function listReleaseAssets(env) {
  const assets = [];

  for (let page = 1; page <= 10; page += 1) {
    const response = await githubFetch(
      `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/releases/${encodeURIComponent(env.GITHUB_RELEASE_ID)}/assets?per_page=100&page=${page}`,
      env.GITHUB_TOKEN,
    );
    if (!response.ok) {
      console.error(`Kunne ikke liste GitHub-assets (${response.status}): ${await response.text()}`);
      return null;
    }

    const pageAssets = await response.json();
    assets.push(...pageAssets);
    if (pageAssets.length < 100) break;
  }

  return assets.sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function githubFetch(url, token, accept = "application/vnd.github+json", options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "User-Agent": "bryllupsbilder-worker",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
}

function getAdminConfigurationError(env, headers = {}) {
  const missingConfiguration = [
    "ADMIN_GITHUB_LOGIN",
    "ADMIN_SESSION_SECRET",
    "ADMIN_URL",
    "GITHUB_OAUTH_CALLBACK_URL",
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
    "GITHUB_OWNER",
    "GITHUB_RELEASE_ID",
    "GITHUB_REPO",
    "GITHUB_TOKEN",
  ].filter((key) => !env[key]);

  if (missingConfiguration.length === 0) return null;

  console.error(`Mangler admin-konfigurasjon: ${missingConfiguration.join(", ")}`);
  return jsonResponse({ error: "Administrasjon er ikke konfigurert ennå." }, 503, headers);
}

function redirectToAdmin(env, error) {
  const adminUrl = new URL(env.ADMIN_URL);
  adminUrl.searchParams.set("error", error);
  return Response.redirect(adminUrl.toString(), 302);
}

async function createSignedToken(payload, secret) {
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(encodedPayload, secret);
  return `${encodedPayload}.${bytesToBase64Url(signature)}`;
}

async function verifySignedToken(token, secret, expectedKind) {
  const [encodedPayload, encodedSignature, ...rest] = token.split(".");
  if (!encodedPayload || !encodedSignature || rest.length > 0) return null;

  let signature;
  let payload;
  try {
    signature = base64UrlToBytes(encodedSignature);
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload)));
  } catch {
    return null;
  }

  const key = await getSigningKey(secret);
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(encodedPayload),
  );

  if (!isValid || payload.kind !== expectedKind || payload.exp <= nowInSeconds()) return null;
  return payload;
}

async function sign(value, secret) {
  const key = await getSigningKey(secret);
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
}

function getSigningKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

function cleanGuestName(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

async function detectImageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { extension: "png", contentType: "image/png" };
  }

  const signature = String.fromCharCode(...bytes);
  if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP") {
    return { extension: "webp", contentType: "image/webp" };
  }

  if (signature.slice(4, 8) === "ftyp") {
    const brand = signature.slice(8, 12);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return { extension: "heic", contentType: "image/heic" };
    }
    if (brand === "avif") {
      return { extension: "avif", contentType: "image/avif" };
    }
  }

  return null;
}