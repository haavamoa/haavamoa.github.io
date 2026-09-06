#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const OWNER = "haavamoa";
const REPO = "bryllupsbilder-2026";
const FULL_REPO = `${OWNER}/${REPO}`;
const RELEASES_URL = `https://github.com/${FULL_REPO}/releases`;
const DOWNLOAD_ROOT_LABEL = "~/Downloads/bryllupsbilder-2026";
const DOWNLOAD_ROOT = path.join(os.homedir(), "Downloads", "bryllupsbilder-2026");
const STAGING_RELATIVE_PATH = "til-icloud";
const IMPORTED_RELATIVE_PATH = "importert";
const MANIFEST_PATH = path.join(__dirname, "icloud-sync-status.json");
const GH_ENV = {
  ...process.env,
  GH_PAGER: "cat",
  PAGER: "cat",
  NO_COLOR: "1",
  GH_FORCE_TTY: "never",
};

const command = process.argv[2] || "status";

try {
  if (command === "status") {
    printStatus();
  } else if (command === "download-new") {
    downloadNewPhotos();
  } else if (command === "mark-imported") {
    markPendingPhotosAsImported();
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else {
    throw new Error(`Ukjent kommando: ${command}`);
  }
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`Bruk:
  node workers/bryllupsbilder/sync-icloud.js status
  node workers/bryllupsbilder/sync-icloud.js download-new
  node workers/bryllupsbilder/sync-icloud.js mark-imported

download-new tømmer ${DOWNLOAD_ROOT_LABEL}/${STAGING_RELATIVE_PATH} og legger kun bilder som ikke er markert importert i iCloud der.
mark-imported kjøres etter at staging-mappen er lagt i iCloud. Den markerer pending bilder som importert og tømmer staging-mappen.`);
}

function printStatus() {
  const manifest = loadManifest();
  const releases = loadReleases();
  const assets = listAssets(releases);
  const importedIds = new Set((manifest.downloadedFiles || [])
    .filter((entry) => entry.icloudImportedAt)
    .map((entry) => entry.assetId));
  const knownIds = new Set((manifest.downloadedFiles || []).map((entry) => entry.assetId));
  const pendingAssets = assets.filter(({ asset }) => !importedIds.has(asset.id));
  const unknownAssets = assets.filter(({ asset }) => !knownIds.has(asset.id));
  const stagingFiles = countFiles(path.join(DOWNLOAD_ROOT, STAGING_RELATIVE_PATH));

  console.log(JSON.stringify({
    githubAssets: assets.length,
    manifestAssets: knownIds.size,
    importedAssets: importedIds.size,
    pendingIcloudAssets: pendingAssets.length,
    unknownAssets: unknownAssets.length,
    stagingDirectory: `${DOWNLOAD_ROOT_LABEL}/${STAGING_RELATIVE_PATH}`,
    stagingFiles,
    nextCommand: pendingAssets.length > 0
      ? "node workers/bryllupsbilder/sync-icloud.js download-new"
      : "Ingen nye bilder funnet.",
  }, null, 2));
}

function downloadNewPhotos() {
  const manifest = loadManifest();
  const releases = loadReleases();
  const assetItems = listAssets(releases);
  const importedIds = new Set((manifest.downloadedFiles || [])
    .filter((entry) => entry.icloudImportedAt)
    .map((entry) => entry.assetId));
  const previousByAssetId = new Map((manifest.downloadedFiles || [])
    .map((entry) => [entry.assetId, entry]));
  const filenameByAssetId = getFilenameByAssetId(assetItems);
  const syncedAt = nowIso();
  const stagingDirectory = path.join(DOWNLOAD_ROOT, STAGING_RELATIVE_PATH);
  const newEntries = [];
  const entries = [];

  resetDirectory(stagingDirectory);

  for (const item of assetItems) {
    const { release, asset } = item;
    const previous = previousByAssetId.get(asset.id);
    const localFileName = previous?.localFileName || filenameByAssetId.get(asset.id);

    if (importedIds.has(asset.id)) {
      entries.push(refreshEntry(release, asset, previous, previous.localRelativePath, previous.downloadedAt, "imported"));
      continue;
    }

    const localRelativePath = `${STAGING_RELATIVE_PATH}/${localFileName}`;
    const targetPath = resolveDownloadPath(localRelativePath);
    downloadAsset(release.tag_name, asset.name, targetPath);

    const entry = refreshEntry(release, asset, previous, localRelativePath, syncedAt, "pending-icloud");
    entry.downloaded = true;
    entry.icloudImported = false;
    delete entry.icloudImportedAt;
    entries.push(entry);

    if (!previous) newEntries.push(entry);
  }

  entries.sort(compareEntries);
  writeManifest(buildManifest(manifest, releases, entries, {
    event: {
      type: "download-new",
      syncedAt,
      newAssetCount: newEntries.length,
      pendingIcloudAssetCount: entries.filter((entry) => !entry.icloudImportedAt).length,
      newAssetIds: newEntries.map((entry) => entry.assetId),
    },
    retrievedAt: syncedAt,
  }));

  console.log(JSON.stringify({
    downloadedNew: newEntries.length,
    pendingIcloudAssets: entries.filter((entry) => !entry.icloudImportedAt).length,
    stagingDirectory: `${DOWNLOAD_ROOT_LABEL}/${STAGING_RELATIVE_PATH}`,
    stagingFiles: countFiles(stagingDirectory),
    localTotalBytes: sumFiles(stagingDirectory),
  }, null, 2));
}

function markPendingPhotosAsImported() {
  const manifest = loadManifest();
  const importedAt = nowIso();
  const entries = (manifest.downloadedFiles || []).map((entry) => ({ ...entry }));
  let importedCount = 0;

  for (const entry of entries) {
    if (entry.icloudImportedAt) {
      entry.icloudImported = true;
      entry.status = "imported";
      continue;
    }

    const importedRelativePath = `${IMPORTED_RELATIVE_PATH}/${entry.tagName}/${entry.localFileName}`;
    moveTrackedFile(entry, importedRelativePath);
    entry.localRelativePath = importedRelativePath;
    entry.icloudImported = true;
    entry.icloudImportedAt = importedAt;
    entry.status = "imported";
    entry.downloaded = fs.existsSync(resolveDownloadPath(importedRelativePath));
    importedCount += 1;
  }

  resetDirectory(path.join(DOWNLOAD_ROOT, STAGING_RELATIVE_PATH));
  removeEmptyReleaseDirectories();
  entries.sort(compareEntries);

  const imports = Array.isArray(manifest.imports) ? manifest.imports : [];
  const nextManifest = buildManifest(manifest, manifest.releases || [], entries, {
    retrievedAt: manifest.source?.retrievedAt || importedAt,
    preserveSyncs: true,
  });
  nextManifest.imports = [
    ...imports,
    {
      importedAt,
      importedAssetCount: importedCount,
      importedAssetIds: entries
        .filter((entry) => entry.icloudImportedAt === importedAt)
        .map((entry) => entry.assetId),
    },
  ];
  nextManifest.download.lastImportedAt = importedAt;
  nextManifest.download.icloudAlbumImported = true;

  writeManifest(nextManifest);

  console.log(JSON.stringify({
    markedImported: importedCount,
    importedAssets: entries.filter((entry) => entry.icloudImportedAt).length,
    pendingIcloudAssets: entries.filter((entry) => !entry.icloudImportedAt).length,
    stagingDirectory: `${DOWNLOAD_ROOT_LABEL}/${STAGING_RELATIVE_PATH}`,
    stagingFiles: countFiles(path.join(DOWNLOAD_ROOT, STAGING_RELATIVE_PATH)),
  }, null, 2));
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { schemaVersion: 3, downloadedFiles: [], syncs: [], imports: [] };
  }

  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function loadReleases() {
  return JSON.parse(execFileSync("gh", ["api", `repos/${OWNER}/${REPO}/releases?per_page=100`], {
    encoding: "utf8",
    env: GH_ENV,
  }));
}

function listAssets(releases) {
  return releases.flatMap((release) => (release.assets || []).map((asset) => ({ release, asset })));
}

function buildManifest(previousManifest, releases, entries, options = {}) {
  const retrievedAt = options.retrievedAt || nowIso();
  const importedAssetCount = entries.filter((entry) => entry.icloudImportedAt).length;
  const pendingIcloudAssetCount = entries.length - importedAssetCount;
  const stagingDirectory = path.join(DOWNLOAD_ROOT, STAGING_RELATIVE_PATH);
  const allLocalFiles = countFiles(DOWNLOAD_ROOT);
  const allLocalBytes = sumFiles(DOWNLOAD_ROOT);
  const assetTotalBytes = entries.reduce((sum, entry) => sum + Number(entry.size || 0), 0);
  const syncs = Array.isArray(previousManifest.syncs) ? previousManifest.syncs : [];

  return {
    schemaVersion: 3,
    source: {
      owner: OWNER,
      repo: REPO,
      releasesUrl: RELEASES_URL,
      retrievedAt,
    },
    download: {
      downloadedAt: previousManifest.download?.downloadedAt || retrievedAt,
      lastSyncedAt: options.event?.syncedAt || previousManifest.download?.lastSyncedAt || retrievedAt,
      downloadRoot: DOWNLOAD_ROOT_LABEL,
      stagingRelativePath: STAGING_RELATIVE_PATH,
      stagingDirectory: `${DOWNLOAD_ROOT_LABEL}/${STAGING_RELATIVE_PATH}`,
      importedRelativePath: IMPORTED_RELATIVE_PATH,
      importedDirectory: `${DOWNLOAD_ROOT_LABEL}/${IMPORTED_RELATIVE_PATH}`,
      localFileCount: allLocalFiles,
      localTotalBytes: allLocalBytes,
      stagingFileCount: countFiles(stagingDirectory),
      stagingTotalBytes: sumFiles(stagingDirectory),
      releaseCount: releases.length,
      assetCount: entries.length,
      assetTotalBytes,
      importedAssetCount,
      pendingIcloudAssetCount,
      icloudAlbumImported: pendingIcloudAssetCount === 0,
      namingStrategy: "local filenames are based on GitHub Release asset labels; asset id is appended when labels would collide",
      renamedAt: previousManifest.download?.renamedAt || retrievedAt,
      lastImportedAt: previousManifest.download?.lastImportedAt,
    },
    releases: releases.map((release) => ({
      releaseId: release.releaseId || release.id,
      tagName: release.tagName || release.tag_name,
      name: release.name,
      publishedAt: release.publishedAt || release.published_at,
      assetCount: release.assetCount ?? (release.assets || []).length,
      downloadedSubdirectory: release.downloadedSubdirectory || release.tag_name || release.tagName,
    })),
    syncs: options.event ? [...syncs, options.event] : syncs,
    imports: Array.isArray(previousManifest.imports) ? previousManifest.imports : [],
    downloadedFiles: entries,
  };
}

function refreshEntry(release, asset, previous, localRelativePath, downloadedAt, status) {
  const entry = {
    assetId: asset.id,
    releaseId: release.id,
    tagName: release.tag_name,
    releaseAssetName: asset.name,
    releaseLabel: asset.label || null,
    size: asset.size,
    contentType: asset.content_type,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
    originalLocalRelativePath: `${release.tag_name}/${asset.name}`,
    localFileName: previous?.localFileName || path.basename(localRelativePath),
    localRelativePath,
    downloadedAt,
    downloaded: fs.existsSync(resolveDownloadPath(localRelativePath)),
    status,
  };

  if (previous?.icloudImportedAt || status === "imported") {
    entry.icloudImported = true;
    entry.icloudImportedAt = previous?.icloudImportedAt;
  } else {
    entry.icloudImported = false;
  }

  return entry;
}

function getFilenameByAssetId(assetItems) {
  const baseCounts = new Map();

  for (const { release, asset } of assetItems) {
    const baseName = `${safeStem(asset)}${getExtension(asset)}`;
    const key = `${release.tag_name}/${baseName}`;
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  }

  return new Map(assetItems.map(({ release, asset }) => {
    const extension = getExtension(asset);
    const stem = safeStem(asset);
    const baseName = `${stem}${extension}`;
    const key = `${release.tag_name}/${baseName}`;
    const fileName = baseCounts.get(key) > 1 ? `${stem} - ${asset.id}${extension}` : baseName;
    return [asset.id, fileName];
  }));
}

function getExtension(asset) {
  const extension = path.extname(asset.name || "").toLowerCase();
  if (extension) return extension;

  return {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "image/heic": ".heic",
    "image/heif": ".heif",
  }[asset.content_type] || "";
}

function safeStem(asset) {
  const originalStem = path.basename(asset.name || "bilde", path.extname(asset.name || ""));
  const label = typeof asset.label === "string" ? asset.label.trim() : "";
  const rawStem = label || originalStem;
  const stem = rawStem
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/:/g, " -")
    .replace(/[?*"<>|]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+/g, " - ")
    .replace(/^[.\s]+|[.\s]+$/g, "");

  return truncateStem(stem || originalStem || "bilde");
}

function truncateStem(stem, maxLength = 150) {
  if (stem.length <= maxLength) return stem;
  return stem.slice(0, maxLength).replace(/[\s.-]+$/g, "");
}

function downloadAsset(tagName, assetName, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath);

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bryllupsbilder-asset-"));
  const tempAssetPath = path.join(tempDirectory, assetName);

  try {
    execFileSync("gh", [
      "release",
      "download",
      tagName,
      "-R",
      FULL_REPO,
      "--pattern",
      assetName,
      "--dir",
      tempDirectory,
      "--clobber",
    ], { stdio: "pipe", env: GH_ENV });

    if (!fs.existsSync(tempAssetPath)) {
      throw new Error(`Nedlastet asset mangler: ${assetName}`);
    }

    fs.renameSync(tempAssetPath, targetPath);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function moveTrackedFile(entry, targetRelativePath) {
  const targetPath = resolveDownloadPath(targetRelativePath);
  const sourcePath = findExistingTrackedFile(entry);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (!sourcePath) {
    return;
  }

  if (sourcePath === targetPath) {
    return;
  }

  if (fs.existsSync(targetPath)) {
    throw new Error(`Maalfilen finnes allerede: ${targetPath}`);
  }

  fs.renameSync(sourcePath, targetPath);
}

function findExistingTrackedFile(entry) {
  const candidates = [
    entry.localRelativePath,
    `${entry.tagName}/${entry.localFileName}`,
    `${entry.tagName}/${entry.releaseAssetName}`,
    `${STAGING_RELATIVE_PATH}/${entry.localFileName}`,
    `${IMPORTED_RELATIVE_PATH}/${entry.tagName}/${entry.localFileName}`,
  ].filter(Boolean);

  for (const relativePath of candidates) {
    const filePath = resolveDownloadPath(relativePath);
    if (fs.existsSync(filePath)) return filePath;
  }

  return null;
}

function resetDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function removeEmptyReleaseDirectories() {
  if (!fs.existsSync(DOWNLOAD_ROOT)) return;

  for (const name of fs.readdirSync(DOWNLOAD_ROOT)) {
    const directory = path.join(DOWNLOAD_ROOT, name);
    if (!fs.statSync(directory).isDirectory()) continue;
    if (name === STAGING_RELATIVE_PATH || name === IMPORTED_RELATIVE_PATH) continue;
    if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  }
}

function resolveDownloadPath(relativePath) {
  const resolvedRoot = path.resolve(DOWNLOAD_ROOT);
  const resolvedPath = path.resolve(DOWNLOAD_ROOT, relativePath);

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Ugyldig lokal sti: ${relativePath}`);
  }

  return resolvedPath;
}

function countFiles(directory) {
  if (!fs.existsSync(directory)) return 0;

  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const childPath = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countFiles(childPath);
    if (entry.isFile()) count += 1;
  }
  return count;
}

function sumFiles(directory) {
  if (!fs.existsSync(directory)) return 0;

  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const childPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += sumFiles(childPath);
    if (entry.isFile()) total += fs.statSync(childPath).size;
  }
  return total;
}

function compareEntries(left, right) {
  return left.tagName.localeCompare(right.tagName)
    || left.createdAt.localeCompare(right.createdAt)
    || left.localFileName.localeCompare(right.localFileName);
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}