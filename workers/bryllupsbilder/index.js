const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    const allowedOrigin = getAllowedOrigin(origin, env.ALLOWED_ORIGINS);
    const corsHeaders = getCorsHeaders(allowedOrigin);

    if (request.method === "OPTIONS") {
      if (!allowedOrigin) {
        return jsonResponse({ error: "Ugyldig opprinnelse." }, 403);
      }

      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/upload") {
      return jsonResponse({ error: "Ikke funnet." }, 404, corsHeaders);
    }

    if (!allowedOrigin) {
      return jsonResponse({ error: "Ugyldig opprinnelse." }, 403);
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
    "Access-Control-Allow-Headers": "Content-Type, X-Upload-Client",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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