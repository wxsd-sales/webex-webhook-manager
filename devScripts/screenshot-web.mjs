import { mkdir } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const baseUrl = process.env.SCREENSHOT_URL || `http://${host}:${port}`;
const outputDir = process.env.SCREENSHOT_DIR || "screenshots";
const virtualTimeBudget = process.env.SCREENSHOT_VIRTUAL_TIME_BUDGET || "5000";
const verbose = ["1", "true", "yes"].includes(
  String(process.env.SCREENSHOT_VERBOSE || "").toLowerCase(),
);

/**
 * Capture targets. Headless Chrome cannot scroll before it screenshots, so each
 * "scrolled and cropped" view is produced by the app's screenshot mode (it hides
 * the content above the region of interest) combined with the `height` below,
 * which crops the bottom. Tune `height` to frame each state.
 */
const VIEWS = [
  { name: "enterToken", width: 1280, height: 545 },
  { name: "connected", width: 1280, height: 760 },
  { name: "existingWebhooks", width: 1280, height: 720 },
  { name: "createWebhooks", width: 1280, height: 820 },
  { name: "generateTests", width: 1280, height: 840 },
  { name: "customiseTest", width: 1280, height: 800 },
  { name: "exampleTextJson", width: 1280, height: 900 },
];

const themes = ["light", "dark"];

const chrome = findChrome();
let server;

try {
  await mkdir(outputDir, { recursive: true });

  if (await isUrlReady(baseUrl)) {
    console.log(`Using existing web server at ${baseUrl}`);
  } else {
    console.log(`Starting web server at ${baseUrl}`);
    server = startServer();
  }
  await waitForUrl(baseUrl);

  for (const view of VIEWS) {
    await captureView(view);
  }

  console.log(
    `Saved ${VIEWS.length * themes.length} screenshots to ${outputDir}`,
  );
} finally {
  if (server) server.kill();
}

async function captureView({ name, width, height }) {
  const size = `${width},${height}`;
  for (const theme of themes) {
    await captureScreenshot({
      filePath: path.join(outputDir, `${name}-${theme}.png`),
      size,
      url: getShotUrl(name, theme),
    });
  }
}

function findChrome() {
  const configured = process.env.CHROME_PATH;
  const candidates = [
    configured,
    "google-chrome",
    "google-chrome-stable",
    "chromium-browser",
    "chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"]);
    if (result.status == 0) return candidate;
  }

  throw new Error(
    "Chrome/Chromium was not found. Set CHROME_PATH or install Chrome/Chromium.",
  );
}

function startServer() {
  let errorOutput = "";
  const child = spawn(process.execPath, ["devScripts/serve-web.mjs"], {
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => {
    errorOutput += chunk;
    if (verbose) process.stderr.write(chunk);
  });
  child.on("exit", (code, signal) => {
    child.startupError = new Error(
      [
        `Web server exited before screenshots were captured (${describeExit(code, signal)}).`,
        errorOutput.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  });

  return child;
}

async function waitForUrl(url) {
  let lastError;

  for (let i = 0; i < 30; i += 1) {
    if (server?.startupError) throw server.startupError;

    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }

  if (server?.startupError) throw server.startupError;
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message}`);
}

async function isUrlReady(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function getShotUrl(view, theme) {
  const root = baseUrl.replace(/\/$/, "");
  const indexUrl = `${root}/index.html`;
  const params = new URLSearchParams();

  params.set("view", view);
  params.set("theme", theme);

  return `${indexUrl}#${params.toString()}`;
}

function captureScreenshot({ filePath, size, url }) {
  return new Promise((resolve, reject) => {
    console.log(`Capturing ${filePath}`);

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
        `--window-size=${size}`,
        `--virtual-time-budget=${virtualTimeBudget}`,
        `--screenshot=${filePath}`,
        url,
      ],
      {
        stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    let errorOutput = "";

    if (!verbose) {
      child.stdout?.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        errorOutput += chunk;
      });
    }

    child.on("exit", (code) => {
      if (code == 0) {
        resolve();
        return;
      }

      if (output) process.stdout.write(output);
      if (errorOutput) process.stderr.write(errorOutput);
      reject(new Error(`Chrome exited with status ${code}`));
    });
    child.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeExit(code, signal) {
  if (signal) return `signal ${signal}`;
  return `status ${code}`;
}
