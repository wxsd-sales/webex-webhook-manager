/**
 * Favicon generator.
 *
 * Fetches a Momentum Design icon (SVG) and produces a full, cross-browser
 * favicon set into the /images directory:
 *   - favicon.svg               theme-adaptive (light/dark) vector icon
 *   - favicon-16/32/48.png      raster fallbacks (incl. Safari)
 *   - favicon.ico               legacy multi-size container (16/32/48)
 *   - apple-touch-icon.png      180x180 iOS home-screen tile (solid backdrop)
 *   - android-chrome-192/512    Android / PWA icons
 *   - site.webmanifest          minimal web app manifest
 *
 * Rasterization is done with headless Chrome (same approach as
 * screenshot-web.mjs) so the script has zero npm dependencies. The Momentum
 * SVGs ship without a `fill`, so a brand colour is injected here — the vector
 * favicon additionally adapts to the tab's colour scheme.
 *
 * Usage: `npm run favicons` (override via FAVICON_* env vars).
 */
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const ICON_NAME = process.env.FAVICON_ICON || "webhook-bold";
const ICON_VERSION = process.env.FAVICON_ICON_VERSION || "0.54.0";
const ICON_URL = `https://cdn.jsdelivr.net/npm/@momentum-design/icons@${ICON_VERSION}/dist/svg/${ICON_NAME}.svg`;
const OUTPUT_DIR = process.env.FAVICON_OUTPUT_DIR || "images";
const COLOR_LIGHT = process.env.FAVICON_COLOR_LIGHT || "#1170cf";
const COLOR_DARK = process.env.FAVICON_COLOR_DARK || "#64b4fa";
const BACKGROUND = process.env.FAVICON_BACKGROUND || "#ffffff";
const APP_NAME = process.env.FAVICON_APP_NAME || "Webex Webhook Manager";
const APP_SHORT_NAME = process.env.FAVICON_APP_SHORT_NAME || "Webhooks";
const verbose = ["1", "true", "yes"].includes(
  String(process.env.FAVICON_VERBOSE || "").toLowerCase(),
);

/**
 * Raster outputs. `background: null` keeps the PNG transparent; a hex value
 * paints a solid tile (used for the Apple touch icon, which iOS renders on a
 * rounded square where transparency would fall back to black). `padding` is a
 * fraction of the icon size reserved as empty margin.
 */
const PNG_TARGETS = [
  { file: "favicon-16x16.png", size: 16, background: null, padding: 0 },
  { file: "favicon-32x32.png", size: 32, background: null, padding: 0 },
  { file: "favicon-48x48.png", size: 48, background: null, padding: 0 },
  { file: "apple-touch-icon.png", size: 180, background: BACKGROUND, padding: 0.18 },
  { file: "android-chrome-192x192.png", size: 192, background: null, padding: 0.08 },
  { file: "android-chrome-512x512.png", size: 512, background: null, padding: 0.08 },
];

/** Sizes packed into favicon.ico, sourced from the generated PNGs above. */
const ICO_SIZES = [16, 32, 48];

const chrome = findChrome();

let tempDir;
try {
  console.log(`Fetching ${ICON_URL}`);
  const { inner, viewBox } = await fetchIcon();

  await mkdir(OUTPUT_DIR, { recursive: true });
  tempDir = await mkdtemp(path.join(tmpdir(), "wwm-favicons-"));

  // Vector favicon (theme-adaptive).
  const faviconSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
    `<style>svg{fill:${COLOR_LIGHT}}` +
    `@media (prefers-color-scheme:dark){svg{fill:${COLOR_DARK}}}</style>` +
    `${inner}</svg>\n`;
  await writeFile(path.join(OUTPUT_DIR, "favicon.svg"), faviconSvg);
  console.log("Wrote favicon.svg");

  // Raster outputs.
  const pngBySize = new Map();
  for (const target of PNG_TARGETS) {
    const buffer = await renderPng({ inner, viewBox, ...target });
    await writeFile(path.join(OUTPUT_DIR, target.file), buffer);
    pngBySize.set(target.size, buffer);
    console.log(`Wrote ${target.file}`);
  }

  // Legacy .ico container built from the small PNGs.
  const icoImages = ICO_SIZES.map((size) => ({
    size,
    buffer: pngBySize.get(size),
  }));
  await writeFile(path.join(OUTPUT_DIR, "favicon.ico"), buildIco(icoImages));
  console.log("Wrote favicon.ico");

  // Web app manifest (paths are relative to the manifest inside /images).
  const manifest = {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    icons: [
      { src: "android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    start_url: "../",
    scope: "../",
    theme_color: COLOR_LIGHT,
    background_color: BACKGROUND,
    display: "standalone",
  };
  await writeFile(
    path.join(OUTPUT_DIR, "site.webmanifest"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log("Wrote site.webmanifest");

  console.log(`\nDone. Add these to <head> in index.html:\n${linkSnippet()}`);
} finally {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/** Downloads the icon and splits it into its viewBox + inner markup. */
async function fetchIcon() {
  const response = await fetch(ICON_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch icon "${ICON_NAME}" (HTTP ${response.status}). ` +
        `Check the icon name at ${ICON_URL}.`,
    );
  }
  const svg = await response.text();
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] || "0 0 32 32";
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .trim();
  if (!inner) {
    throw new Error(`Icon "${ICON_NAME}" had no drawable content.`);
  }
  return { inner, viewBox };
}

/** Renders the icon to a PNG buffer of `size`x`size` via headless Chrome. */
async function renderPng({ inner, viewBox, size, background, padding }) {
  const inset = Math.round(size * (padding || 0));
  const iconSize = size - inset * 2;
  const bg = background || "transparent";
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html,body{margin:0;padding:0}` +
    `body{width:${size}px;height:${size}px;display:flex;align-items:center;` +
    `justify-content:center;background:${bg}}` +
    `svg{display:block;width:${iconSize}px;height:${iconSize}px}` +
    `</style></head><body>` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="${COLOR_LIGHT}">` +
    `${inner}</svg></body></html>`;

  const htmlPath = path.join(tempDir, `icon-${size}.html`);
  const outPath = path.join(tempDir, `icon-${size}.png`);
  await writeFile(htmlPath, html);
  await captureScreenshot(htmlPath, outPath, size);
  return readFile(outPath);
}

/** Drives headless Chrome to screenshot an HTML file at an exact pixel size. */
function captureScreenshot(htmlPath, outPath, size) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-logging",
        "--hide-scrollbars",
        "--log-level=3",
        "--force-device-scale-factor=1",
        "--default-background-color=00000000",
        `--window-size=${size},${size}`,
        `--screenshot=${outPath}`,
        `file://${htmlPath}`,
      ],
      { stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"] },
    );

    let errorOutput = "";
    child.stderr?.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Chrome exited with status ${code}\n${errorOutput.trim()}`));
    });
    child.on("error", reject);
  });
}

/**
 * Packs PNG buffers into an ICO container. ICO stores a directory of entries
 * followed by the raw image data; embedding PNGs directly is supported on all
 * current browsers/OSes.
 */
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const directory = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;

  images.forEach((image, index) => {
    const entry = index * 16;
    const dimension = image.size >= 256 ? 0 : image.size; // 0 means 256
    directory.writeUInt8(dimension, entry + 0); // width
    directory.writeUInt8(dimension, entry + 1); // height
    directory.writeUInt8(0, entry + 2); // palette size
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.buffer.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.buffer.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.buffer)]);
}

/** The <link>/<meta> block to paste into index.html. */
function linkSnippet() {
  return [
    `    <link rel="icon" href="${OUTPUT_DIR}/favicon.ico" sizes="any" />`,
    `    <link rel="icon" type="image/svg+xml" href="${OUTPUT_DIR}/favicon.svg" />`,
    `    <link rel="icon" type="image/png" sizes="32x32" href="${OUTPUT_DIR}/favicon-32x32.png" />`,
    `    <link rel="icon" type="image/png" sizes="16x16" href="${OUTPUT_DIR}/favicon-16x16.png" />`,
    `    <link rel="apple-touch-icon" sizes="180x180" href="${OUTPUT_DIR}/apple-touch-icon.png" />`,
    `    <link rel="manifest" href="${OUTPUT_DIR}/site.webmanifest" />`,
    `    <meta name="theme-color" content="${COLOR_LIGHT}" />`,
  ].join("\n");
}

/** Locates a Chrome/Chromium binary (mirrors screenshot-web.mjs). */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "google-chrome",
    "google-chrome-stable",
    "chromium-browser",
    "chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"]);
    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "Chrome/Chromium was not found. Set CHROME_PATH or install Chrome/Chromium.",
  );
}
