/**
 * Mock data + view registry for headless screenshots.
 *
 * The web app enters "screenshot mode" when the URL hash contains a recognised
 * `view`, e.g. `index.html#view=connected&theme=dark`. main.js reads the view,
 * arranges the DOM with the fixtures below (no network calls) and adds a
 * `data-screenshot-view` attribute so styles.css can crop to the region of
 * interest. Nothing here contains real credentials — the token and secret are
 * obviously fake demo strings used only to render the UI.
 */

/** Views captured by scripts/screenshot-web.mjs, in capture order. */
export const SCREENSHOT_VIEWS = [
  "enterToken",
  "connected",
  "existingWebhooks",
  "createWebhooks",
  "generateTests",
  "customiseTest",
  "exampleTextJson",
];

/** Reads a recognised `view` from the URL hash, or null when not in shot mode. */
export function parseScreenshotViewFromHash() {
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (!raw) {
    return null;
  }

  const view = new URLSearchParams(raw).get("view");

  return SCREENSHOT_VIEWS.includes(view) ? view : null;
}

/** Obviously-fake placeholder token so the password field renders as dots. */
export const MOCK_TOKEN =
  "DEMO_SCREENSHOT_TOKEN_not-a-real-credential_0000000000000000000000";

/** Fake shared secret used to sign the sample generated payload. */
export const MOCK_SECRET = "demo-shared-secret";

/** Bot identity, shaped like getMyOwnDetails() output. Avatar omitted so the
 *  icon placeholder is used (no external image fetch during capture). */
export const MOCK_BOT = {
  displayName: "Lambda Helper Bot",
  nickName: "Lambda Helper",
  emails: ["lambda-helper@webex.bot"],
  avatar: null,
};

/** Sample webhooks, shaped like the Webex list-webhooks response. */
export const MOCK_WEBHOOKS = [
  {
    id: "Y2lzY29zcGFyazovL3VzL1dFQkhPT0svmessages00000000",
    name: "Lambda Bot - messages",
    resource: "messages",
    event: "created",
    status: "active",
    targetUrl: "https://k7q2m9x4.lambda-url.eu-west-1.on.aws/",
    created: "2026-07-09T14:12:03.000Z",
  },
  {
    id: "Y2lzY29zcGFyazovL3VzL1dFQkhPT0svattachment0000000",
    name: "Lambda Bot - attachmentActions",
    resource: "attachmentActions",
    event: "created",
    status: "active",
    targetUrl: "https://k7q2m9x4.lambda-url.eu-west-1.on.aws/",
    created: "2026-07-09T14:12:04.000Z",
  },
  {
    id: "Y2lzY29zcGFyazovL3VzL1dFQkhPT0svmemberships000000",
    name: "Lambda Bot - memberships",
    resource: "memberships",
    event: "created",
    status: "active",
    targetUrl: "https://k7q2m9x4.lambda-url.eu-west-1.on.aws/",
    created: "2026-07-09T14:12:05.000Z",
  },
];

/** Prefilled message markdown for the "customise test" view. */
export const MOCK_MESSAGE_MARKDOWN =
  "Please **approve** or **reject** the deployment to production.";

/** Prefilled attachment-action inputs JSON for the "customise test" view. */
export const MOCK_ATTACHMENT_INPUTS = JSON.stringify(
  { action: "approve", comment: "Looks good to me" },
  null,
  2,
);
