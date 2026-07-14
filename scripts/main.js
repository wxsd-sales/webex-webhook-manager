import Webex from "./webex.js";
import { resolveWebexApiBaseUrl } from "./webex-config.js";
import {
  parseScreenshotViewFromHash,
  MOCK_TOKEN,
  MOCK_SECRET,
  MOCK_BOT,
  MOCK_WEBHOOKS,
  MOCK_MESSAGE_MARKDOWN,
  MOCK_ATTACHMENT_INPUTS,
} from "./screenshot-mock.js";

/**
 * Common bot webhook resource/event combinations. Messages + attachmentActions
 * on "created" cover the typical AWS Lambda card-based bot, so they are the
 * defaults; the rest are opt-in.
 *
 * Each preset carries a `custom` list describing the fields the payload
 * generator renders inline under the option when it is selected. Field types:
 *   - "markdown": plain multiline text
 *   - "json":     multiline text parsed as JSON
 *   - "text":     single-line text
 *   - "toggle":   boolean checkbox
 */
const RESOURCE_PRESETS = [
  {
    resource: "messages",
    event: "created",
    label: "Messages",
    hint: "New messages sent to your bot (mentions and 1:1 chats).",
    checked: true,
    custom: [
      {
        key: "messageText",
        type: "markdown",
        label: "Message markdown",
        rows: 3,
        value: "Hello from the test harness!",
        hint: "Added as text and markdown on the message payload's data object.",
      },
    ],
  },
  {
    resource: "attachmentActions",
    event: "created",
    label: "Attachment Actions",
    hint: "Adaptive Card button submissions.",
    checked: true,
    custom: [
      {
        key: "inputs",
        type: "json",
        label: "Attachment action inputs (JSON)",
        rows: 6,
        value: '{\n  "action": "approve",\n  "comment": "Looks good to me"\n}',
        hint: "The submitted Adaptive Card inputs object. Must be valid JSON.",
      },
    ],
  },
  {
    resource: "memberships",
    event: "created",
    label: "Memberships added",
    hint: "Your bot is added to a space or someone joins.",
    checked: false,
    custom: [
      {
        key: "personEmail",
        type: "text",
        label: "Person email",
        value: "newmember@example.com",
        hint: "Email of the person added to the space.",
      },
      {
        key: "personDisplayName",
        type: "text",
        label: "Person display name",
        value: "New Member",
      },
      {
        key: "isModerator",
        type: "toggle",
        label: "Added as a moderator",
        value: false,
      },
    ],
  },
  {
    resource: "memberships",
    event: "deleted",
    label: "Memberships removed",
    hint: "Your bot is removed or someone leaves a space.",
    checked: false,
    custom: [
      {
        key: "personEmail",
        type: "text",
        label: "Person email",
        value: "formermember@example.com",
        hint: "Email of the person removed from the space.",
      },
      {
        key: "personDisplayName",
        type: "text",
        label: "Person display name",
        value: "Former Member",
      },
      {
        key: "isModerator",
        type: "toggle",
        label: "Was a moderator",
        value: false,
      },
    ],
  },
  {
    resource: "rooms",
    event: "updated",
    label: "Rooms updated",
    hint: "A space title or state changes.",
    checked: false,
    custom: [
      {
        key: "title",
        type: "text",
        label: "Room title",
        value: "Renamed Space",
        hint: "The space's title after the update.",
      },
      {
        key: "isLocked",
        type: "toggle",
        label: "Moderated space (locked)",
        value: false,
      },
    ],
  },
];

/**
 * The connected Webex client. Held only in memory for the life of the page so
 * the bot token is never persisted to disk or storage.
 */
let webex = null;

const els = {
  connectForm: document.getElementById("connectForm"),
  tokenInput: document.getElementById("tokenInput"),
  toggleTokenBtn: document.getElementById("toggleTokenBtn"),
  connectBtn: document.getElementById("connectBtn"),
  disconnectBtn: document.getElementById("disconnectBtn"),
  botIdentity: document.getElementById("botIdentity"),
  botAvatar: document.getElementById("botAvatar"),
  botName: document.getElementById("botName"),
  botEmail: document.getElementById("botEmail"),
  connectStatus: document.getElementById("connectStatus"),

  webhooksSection: document.getElementById("webhooks"),
  webhookList: document.getElementById("webhookList"),
  webhookStatus: document.getElementById("webhookStatus"),
  refreshBtn: document.getElementById("refreshBtn"),
  deleteAllBtn: document.getElementById("deleteAllBtn"),

  createSection: document.getElementById("create"),
  createForm: document.getElementById("createForm"),
  targetUrl: document.getElementById("targetUrl"),
  namePrefix: document.getElementById("namePrefix"),
  secret: document.getElementById("secret"),
  resourceList: document.getElementById("resourceList"),
  createStatus: document.getElementById("createStatus"),
};

/** Sets a status banner's message and kind, hiding it when the message is empty. */
function setStatus(el, message, kind = "") {
  if (!el) {
    return;
  }
  el.textContent = message || "";
  el.hidden = !message;
  el.dataset.kind = kind;
}

/** Human-friendly message from a WebexHttpError or generic Error. */
function describeError(error) {
  if (!error) {
    return "Something went wrong.";
  }
  if (error.status === 401) {
    return "That token was rejected (401). Check you pasted a valid bot token.";
  }
  const trackingId = error.trackingId ? ` (trackingId: ${error.trackingId})` : "";
  return `${error.message || "Request failed."}${trackingId}`;
}

/** Small DOM builder: el("div", { class: "x" }, [child, "text"]). */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (key === "class") {
      node.className = value;
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Wires a password field's show/hide reveal button. */
function wireRevealToggle(button, input, noun = "value") {
  if (!button || !input) {
    return;
  }
  button.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", `${show ? "Hide" : "Show"} ${noun}`);
    const icon = button.querySelector(".icon");
    if (icon) {
      icon.classList.toggle("icon-show-regular", !show);
      icon.classList.toggle("icon-hide-regular", show);
    }
  });
}

/**
 * Renders the list of webhooks. Every value comes from the Webex API and is
 * inserted via textContent / DOM nodes (never innerHTML) to prevent any HTML
 * injection from webhook names or target URLs.
 */
function renderWebhooks(items) {
  els.webhookList.replaceChildren();

  if (!items.length) {
    els.webhookList.append(
      el("p", { class: "empty-state" }, "No webhooks are registered for this bot yet."),
    );
    els.deleteAllBtn.disabled = true;
    return;
  }

  els.deleteAllBtn.disabled = false;

  for (const hook of items) {
    const isActive = (hook.status || "active") === "active";

    const badges = el("div", { class: "webhook-card__badges" }, [
      el("span", { class: "badge badge--resource" }, hook.resource || "?"),
      el("span", { class: "badge badge--event" }, hook.event || "?"),
      el(
        "span",
        { class: `badge ${isActive ? "badge--active" : "badge--inactive"}` },
        hook.status || "active",
      ),
    ]);

    const meta = el("dl", { class: "webhook-card__meta" }, [
      el("div", {}, [el("dt", {}, "Target URL"), el("dd", {}, hook.targetUrl || "\u2014")]),
      el("div", {}, [el("dt", {}, "Created"), el("dd", {}, formatDate(hook.created) || "\u2014")]),
      el("div", {}, [el("dt", {}, "ID"), el("dd", { class: "webhook-card__id" }, hook.id || "\u2014")]),
    ]);

    const deleteBtn = el(
      "button",
      {
        type: "button",
        class: "icon-button icon-button--with-label danger-button",
        dataset: { webhookId: hook.id, webhookName: hook.name || "" },
      },
      [
        el("span", { class: "icon icon-delete-regular", "aria-hidden": "true" }),
        el("span", { class: "icon-button__label" }, "Delete"),
      ],
    );

    const header = el("div", { class: "webhook-card__header" }, [
      el("div", { class: "webhook-card__title-wrap" }, [
        el("span", { class: "webhook-card__title" }, hook.name || "(unnamed webhook)"),
        badges,
      ]),
      deleteBtn,
    ]);

    els.webhookList.append(el("div", { class: "webhook-card" }, [header, meta]));
  }
}

/** Fetches and renders the current webhooks. */
async function loadWebhooks() {
  if (!webex) {
    return;
  }
  setStatus(els.webhookStatus, "Loading webhooks\u2026", "pending");
  try {
    const items = await webex.listWebhooks({ max: 100 });
    renderWebhooks(items);
    setStatus(
      els.webhookStatus,
      `${items.length} webhook${items.length === 1 ? "" : "s"} found.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    renderWebhooks([]);
    setStatus(els.webhookStatus, describeError(error), "error");
  }
}

/** Reveals or hides the webhook + create sections based on connection state. */
function setConnectedUi(connected, person = null) {
  els.webhooksSection.hidden = !connected;
  els.createSection.hidden = !connected;
  els.disconnectBtn.hidden = !connected;
  els.tokenInput.disabled = connected;
  els.connectBtn.hidden = connected;

  if (connected && person) {
    els.botName.textContent = person.displayName || person.nickName || "Webex bot";
    els.botEmail.textContent = (person.emails && person.emails[0]) || "";
    const avatarSpan = els.botAvatar.querySelector(".icon");
    els.botAvatar.replaceChildren();
    if (person.avatar) {
      els.botAvatar.append(
        el("img", { src: person.avatar, alt: "", class: "bot-identity__avatar-img" }),
      );
    } else if (avatarSpan) {
      els.botAvatar.append(avatarSpan);
    }
    els.botIdentity.hidden = false;
  } else {
    els.botIdentity.hidden = true;
  }
}

function disconnect() {
  webex = null;
  els.tokenInput.value = "";
  setConnectedUi(false);
  els.webhookList.replaceChildren();
  setStatus(els.connectStatus, "");
  setStatus(els.webhookStatus, "");
  setStatus(els.createStatus, "");
}

/** Connect flow: validate token, fetch the bot identity and its webhooks. */
async function connect(event) {
  event.preventDefault();
  const token = els.tokenInput.value.trim();
  if (!token) {
    setStatus(els.connectStatus, "Paste a bot access token to continue.", "error");
    return;
  }

  els.connectBtn.disabled = true;
  setStatus(els.connectStatus, "Connecting\u2026", "pending");

  try {
    const apiBaseUrl = resolveWebexApiBaseUrl();
    const client = new Webex(token, apiBaseUrl);
    const me = await client.getMyOwnDetails();
    webex = client;
    setConnectedUi(true, me);
    setStatus(els.connectStatus, "");
    await loadWebhooks();
  } catch (error) {
    console.error(error);
    webex = null;
    setConnectedUi(false);
    setStatus(els.connectStatus, describeError(error), "error");
  } finally {
    els.connectBtn.disabled = false;
  }
}

/** Deletes a single webhook, then removes its card on success. */
async function handleWebhookListClick(event) {
  const button = event.target.closest("[data-webhook-id]");
  if (!button || !webex) {
    return;
  }
  const { webhookId, webhookName } = button.dataset;
  const label = webhookName ? `"${webhookName}"` : "this webhook";
  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) {
    return;
  }

  button.disabled = true;
  setStatus(els.webhookStatus, "Deleting webhook\u2026", "pending");
  try {
    await webex.deleteWebhook(webhookId);
    await loadWebhooks();
  } catch (error) {
    console.error(error);
    button.disabled = false;
    setStatus(els.webhookStatus, describeError(error), "error");
  }
}

/** Deletes every webhook currently registered for the bot. */
async function deleteAllWebhooks() {
  if (!webex) {
    return;
  }
  let items;
  try {
    items = await webex.listWebhooks({ max: 100 });
  } catch (error) {
    console.error(error);
    setStatus(els.webhookStatus, describeError(error), "error");
    return;
  }

  if (!items.length) {
    setStatus(els.webhookStatus, "There are no webhooks to delete.", "success");
    return;
  }

  if (
    !window.confirm(
      `Delete all ${items.length} webhook${items.length === 1 ? "" : "s"}? This cannot be undone.`,
    )
  ) {
    return;
  }

  els.deleteAllBtn.disabled = true;
  setStatus(els.webhookStatus, `Deleting ${items.length} webhooks\u2026`, "pending");

  let deleted = 0;
  const failures = [];
  for (const hook of items) {
    try {
      await webex.deleteWebhook(hook.id);
      deleted += 1;
    } catch (error) {
      console.error(error);
      failures.push(hook.name || hook.id);
    }
  }

  await loadWebhooks();

  if (failures.length) {
    setStatus(
      els.webhookStatus,
      `Deleted ${deleted}. Failed to delete ${failures.length}: ${failures.join(", ")}.`,
      "error",
    );
  } else {
    setStatus(els.webhookStatus, `Deleted all ${deleted} webhooks.`, "success");
  }
}

/** Builds the resource checkboxes from RESOURCE_PRESETS. */
function renderResourceOptions() {
  els.resourceList.replaceChildren();
  RESOURCE_PRESETS.forEach((preset, index) => {
    const id = `resource-${index}`;
    const input = el("input", {
      type: "checkbox",
      id,
      class: "resource-option__input",
      checked: preset.checked,
      dataset: { resource: preset.resource, event: preset.event },
    });
    const text = el("span", { class: "resource-option__text" }, [
      el("span", { class: "resource-option__label" }, [
        preset.label,
        " ",
        el("code", {}, `${preset.resource}/${preset.event}`),
      ]),
      el("span", { class: "resource-option__hint" }, preset.hint),
    ]);
    els.resourceList.append(
      el("label", { class: "resource-option", for: id }, [input, text]),
    );
  });
}

/** Create flow: one webhook per selected resource, all pointing at targetUrl. */
async function createWebhooks(event) {
  event.preventDefault();
  if (!webex) {
    return;
  }

  const targetUrl = els.targetUrl.value.trim();
  const prefix = els.namePrefix.value.trim() || "Lambda Bot";
  const secret = els.secret.value.trim();

  if (!targetUrl) {
    setStatus(els.createStatus, "Enter a target URL for your bot.", "error");
    return;
  }

  const selected = Array.from(
    els.resourceList.querySelectorAll(".resource-option__input:checked"),
  ).map((input) => ({
    resource: input.dataset.resource,
    event: input.dataset.event,
  }));

  if (!selected.length) {
    setStatus(els.createStatus, "Select at least one resource to create.", "error");
    return;
  }

  els.createForm.querySelector("#createBtn").disabled = true;
  setStatus(
    els.createStatus,
    `Creating ${selected.length} webhook${selected.length === 1 ? "" : "s"}\u2026`,
    "pending",
  );

  let created = 0;
  const failures = [];
  for (const { resource, event: eventName } of selected) {
    const params = {
      name: `${prefix} - ${resource}`,
      targetUrl,
      resource,
      event: eventName,
    };
    if (secret) {
      params.secret = secret;
    }
    try {
      await webex.createWebhook(params);
      created += 1;
    } catch (error) {
      console.error(error);
      failures.push(`${resource}/${eventName}: ${describeError(error)}`);
    }
  }

  els.createForm.querySelector("#createBtn").disabled = false;
  await loadWebhooks();

  if (failures.length) {
    setStatus(
      els.createStatus,
      `Created ${created}. Failed: ${failures.join(" | ")}`,
      "error",
    );
  } else {
    setStatus(
      els.createStatus,
      `Created ${created} webhook${created === 1 ? "" : "s"} pointing at ${targetUrl}.`,
      "success",
    );
  }
}

/** Wires up the webhook manager once the DOM references are available. */
(function initWebhookManager() {
  if (!els.connectForm) {
    return;
  }

  renderResourceOptions();

  els.connectForm.addEventListener("submit", connect);
  els.disconnectBtn.addEventListener("click", disconnect);
  els.refreshBtn.addEventListener("click", loadWebhooks);
  els.deleteAllBtn.addEventListener("click", deleteAllWebhooks);
  els.webhookList.addEventListener("click", handleWebhookListClick);
  els.createForm.addEventListener("submit", createWebhooks);

  wireRevealToggle(els.toggleTokenBtn, els.tokenInput, "token");
})();

/**
 * Tab bar: toggles which top-level panel (Webhooks / Generate Test Payloads)
 * is visible. Mirrors the ARIA tab pattern with arrow-key navigation.
 */
(function initTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  if (!tabs.length) {
    return;
  }

  const activate = (tab) => {
    tabs.forEach((current) => {
      const selected = current === tab;
      current.setAttribute("aria-selected", String(selected));
      current.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(current.dataset.tabTarget);
      if (panel) {
        panel.hidden = !selected;
      }
    });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      next.focus();
      activate(next);
    });
  });
})();

/**
 * Generate Test Payloads tab: produces a signed AWS Lambda test event for each
 * selected webhook resource, so a Lambda-hosted bot can be tested without a
 * live Webex delivery. All work happens locally; the shared secret never
 * leaves the browser.
 */
(function initPayloadGenerator() {
  const p = {
    form: document.getElementById("payloadForm"),
    sharedSecret: document.getElementById("sharedSecret"),
    toggleSecretBtn: document.getElementById("toggleSecretBtn"),
    resourceList: document.getElementById("payloadResourceList"),
    generateBtn: document.getElementById("generateBtn"),
    status: document.getElementById("payloadStatus"),
    output: document.getElementById("payloadOutput"),
  };

  if (!p.form) {
    return;
  }

  /** Generates a v4 UUID, falling back when crypto.randomUUID is unavailable. */
  function randomUuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** Builds a Webex-style hydra ID: base64 of a ciscospark:// URI. */
  function webexId(type) {
    return btoa(`ciscospark://us/${type}/${randomUuid()}`);
  }

  /**
   * HMAC-SHA1 hex digest. Webex's webhook signature (the X-Spark-Signature
   * header) is defined as HMAC-SHA1 of the raw request body using the webhook
   * secret, so SHA-1 is required here for compatibility with Webex — it is not
   * a free security choice. See developer.webex.com webhook docs.
   */
  async function signHmacSha1Hex(secret, message) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(message),
    );
    return Array.from(new Uint8Array(signature))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Builds the resource-specific `data` object for a webhook payload, using the
   * per-resource `custom` values collected from the inline fields.
   */
  function buildResourceData(resource, ids, nowIso, custom) {
    switch (resource) {
      case "messages":
        return {
          id: ids.messageId,
          roomId: ids.roomId,
          roomType: "group",
          personId: ids.personId,
          personEmail: ids.personEmail,
          // Real message webhooks omit the body (the bot fetches it by ID); it
          // is embedded here so the test event can exercise handling directly.
          text: custom.messageText ?? "",
          markdown: custom.messageText ?? "",
          created: nowIso,
        };
      case "attachmentActions":
        return {
          id: webexId("ATTACHMENT_ACTION"),
          type: "submit",
          messageId: ids.messageId,
          personId: ids.personId,
          roomId: ids.roomId,
          // Real attachmentActions webhooks omit inputs (fetched via GET); the
          // submitted inputs are embedded here for testing convenience.
          inputs: custom.inputs ?? {},
          created: nowIso,
        };
      case "memberships":
        return {
          id: webexId("MEMBERSHIP"),
          roomId: ids.roomId,
          roomType: "group",
          personId: ids.personId,
          personEmail: custom.personEmail || ids.personEmail,
          personDisplayName: custom.personDisplayName || "Test Person",
          personOrgId: ids.orgId,
          isModerator: Boolean(custom.isModerator),
          isMonitor: false,
          created: nowIso,
        };
      case "rooms":
        return {
          id: ids.roomId,
          title: custom.title || "Test Space",
          type: "group",
          isLocked: Boolean(custom.isLocked),
          lastActivity: nowIso,
          creatorId: ids.personId,
          created: nowIso,
        };
      default:
        return { id: webexId("UNKNOWN"), created: nowIso };
    }
  }

  /** Builds the full Webex webhook envelope for a resource/event. */
  function buildWebhookEnvelope(resource, event, ids, custom) {
    const nowIso = new Date().toISOString();
    return {
      id: webexId("WEBHOOK"),
      name: `Test Webhook - ${resource}`,
      resource,
      event,
      orgId: ids.orgId,
      createdBy: ids.personId,
      appId: ids.appId,
      ownedBy: "creator",
      status: "active",
      actorId: ids.personId,
      data: buildResourceData(resource, ids, nowIso, custom),
    };
  }

  /**
   * Wraps a signed webhook body in an AWS API Gateway HTTP API (payload format
   * 2.0) proxy event, with the signature in the headers. The account id, api id
   * and domain are illustrative placeholders.
   */
  function buildLambdaEvent(bodyString, signature) {
    const now = new Date();
    const apiId = "abc1234567";
    const region = "eu-west-1";
    const host = `${apiId}.execute-api.${region}.amazonaws.com`;
    const routeKey = "POST /webhook";
    const path = "/webhook";
    const headers = {
      "content-type": "application/json;charset=UTF-8",
      "content-length": String(new TextEncoder().encode(bodyString).length),
      host,
      "user-agent": "SparkWebhook/1.0",
      trackingid: `WEBHOOK_TEST_${randomUuid()}`,
    };
    if (signature) {
      headers["x-spark-signature"] = signature;
    }
    return {
      version: "2.0",
      routeKey,
      rawPath: path,
      rawQueryString: "",
      headers,
      requestContext: {
        accountId: "123456789012",
        apiId,
        domainName: host,
        domainPrefix: apiId,
        http: {
          method: "POST",
          path,
          protocol: "HTTP/1.1",
          sourceIp: "44.234.0.1",
          userAgent: "SparkWebhook/1.0",
        },
        requestId: randomUuid(),
        routeKey,
        stage: "$default",
        time: now.toUTCString(),
        timeEpoch: now.getTime(),
      },
      body: bodyString,
      isBase64Encoded: false,
    };
  }

  /** Renders a single generated payload as a card with a copy button. */
  function renderPayloadCard(resource, event, json) {
    const copyBtn = el(
      "button",
      {
        type: "button",
        class: "icon-button icon-button--with-label secondary-button",
        dataset: { copyPayload: "" },
      },
      [
        el("span", { class: "icon icon-copy-bold", "aria-hidden": "true" }),
        el("span", { class: "icon-button__label" }, "Copy"),
      ],
    );

    const header = el("div", { class: "payload-card__header" }, [
      el("div", { class: "payload-card__title-wrap" }, [
        el("span", { class: "payload-card__title" }, `${resource}/${event}`),
        el("div", { class: "webhook-card__badges" }, [
          el("span", { class: "badge badge--resource" }, resource),
          el("span", { class: "badge badge--event" }, event),
        ]),
      ]),
      copyBtn,
    ]);

    const code = el("pre", { class: "payload-card__code" }, [
      el("code", {}, json),
    ]);

    p.output.append(el("div", { class: "payload-card" }, [header, code]));
  }

  /** Shows the inline customization panel for each checked resource option. */
  function syncCustomFields() {
    p.resourceList
      .querySelectorAll(".resource-option-group")
      .forEach((group) => {
        const input = group.querySelector(".resource-option__input");
        const custom = group.querySelector(".resource-option__custom");
        if (input && custom) {
          custom.hidden = !input.checked;
        }
      });
  }

  /** Builds one inline customization field (`markdown`, `json`, `text`, `toggle`). */
  function renderCustomField(idBase, field) {
    const id = `${idBase}-${field.key}`;
    const dataset = { customKey: field.key, customType: field.type };

    if (field.type === "toggle") {
      const input = el("input", {
        type: "checkbox",
        id,
        class: "custom-toggle__input",
        checked: Boolean(field.value),
        dataset,
      });
      return el("label", { class: "custom-toggle", for: id }, [
        input,
        el("span", { class: "custom-toggle__label" }, field.label),
      ]);
    }

    let control;
    if (field.type === "text") {
      control = el("input", {
        type: "text",
        id,
        class: "field__input",
        value: field.value ?? "",
        autocomplete: "off",
        dataset,
      });
    } else {
      const textareaClass =
        field.type === "json"
          ? "field__input field__textarea field__textarea--code"
          : "field__input field__textarea";
      control = el("textarea", {
        id,
        class: textareaClass,
        rows: field.rows || 3,
        spellcheck: field.type === "json" ? false : undefined,
        value: field.value ?? "",
        dataset,
      });
    }

    return el("div", { class: "field custom-field" }, [
      el("label", { class: "field__label", for: id }, field.label),
      control,
      field.hint ? el("span", { class: "field__hint" }, field.hint) : null,
    ]);
  }

  /**
   * Builds the resource options. Each option is wrapped in a group so its
   * customization fields can sit inline, directly beneath the toggle, and only
   * show while the resource is selected.
   */
  function renderResourceOptions() {
    p.resourceList.replaceChildren();
    RESOURCE_PRESETS.forEach((preset, index) => {
      const id = `payload-resource-${index}`;
      const idBase = `payload-custom-${index}`;
      const input = el("input", {
        type: "checkbox",
        id,
        class: "resource-option__input",
        checked: preset.checked,
        dataset: { resource: preset.resource, event: preset.event },
      });
      const text = el("span", { class: "resource-option__text" }, [
        el("span", { class: "resource-option__label" }, [
          preset.label,
          " ",
          el("code", {}, `${preset.resource}/${preset.event}`),
        ]),
        el("span", { class: "resource-option__hint" }, preset.hint),
      ]);

      const option = el("label", { class: "resource-option", for: id }, [
        input,
        text,
      ]);

      const custom = el(
        "div",
        { class: "resource-option__custom", hidden: !preset.checked },
        (preset.custom || []).map((field) => renderCustomField(idBase, field)),
      );

      p.resourceList.append(
        el(
          "div",
          {
            class: "resource-option-group",
            dataset: { resource: preset.resource, event: preset.event },
          },
          [option, custom],
        ),
      );
    });
  }

  /**
   * Collects the inline customization values for a resource group. `json`
   * fields are parsed (throwing on invalid JSON); `toggle` fields become
   * booleans; everything else stays a string.
   */
  function readCustom(group) {
    const values = {};
    group.querySelectorAll("[data-custom-key]").forEach((field) => {
      const { customKey, customType } = field.dataset;
      if (customType === "toggle") {
        values[customKey] = field.checked;
      } else if (customType === "json") {
        const raw = field.value.trim();
        values[customKey] = raw ? JSON.parse(raw) : {};
      } else {
        values[customKey] = field.value;
      }
    });
    return values;
  }

  async function generatePayloads(event) {
    event.preventDefault();

    const checked = Array.from(
      p.resourceList.querySelectorAll(".resource-option__input:checked"),
    );

    if (!checked.length) {
      setStatus(p.status, "Select at least one resource to generate.", "error");
      return;
    }

    // Collect (and validate) each resource's inline customization up front so a
    // bad JSON field aborts before any signing work happens.
    const jobs = [];
    for (const input of checked) {
      const { resource, event: eventName } = input.dataset;
      const group = input.closest(".resource-option-group");
      try {
        jobs.push({ resource, event: eventName, custom: readCustom(group) });
      } catch {
        setStatus(
          p.status,
          `The JSON customization for ${resource}/${eventName} is invalid.`,
          "error",
        );
        return;
      }
    }

    const secret = p.sharedSecret.value.trim();

    // Shared identifiers keep the generated events internally consistent (same
    // person, room and message across resources).
    const ids = {
      orgId: webexId("ORGANIZATION"),
      personId: webexId("PEOPLE"),
      personEmail: "tester@example.com",
      roomId: webexId("ROOM"),
      appId: webexId("APPLICATION"),
      messageId: webexId("MESSAGE"),
    };

    p.generateBtn.disabled = true;
    setStatus(p.status, "Generating\u2026", "pending");
    p.output.replaceChildren();

    try {
      for (const { resource, event: eventName, custom } of jobs) {
        const webhook = buildWebhookEnvelope(resource, eventName, ids, custom);
        const bodyString = JSON.stringify(webhook);
        const signature = secret
          ? await signHmacSha1Hex(secret, bodyString)
          : "";
        const lambdaEvent = buildLambdaEvent(bodyString, signature);
        renderPayloadCard(resource, eventName, JSON.stringify(lambdaEvent, null, 2));
      }
      setStatus(
        p.status,
        secret
          ? `Generated ${jobs.length} signed test event${jobs.length === 1 ? "" : "s"}.`
          : `Generated ${jobs.length} unsigned test event${jobs.length === 1 ? "" : "s"} (no secret provided).`,
        "success",
      );
    } catch (error) {
      console.error(error);
      setStatus(p.status, `Failed to generate payloads: ${error.message}`, "error");
    } finally {
      p.generateBtn.disabled = false;
    }
  }

  /** Copy handler (event delegation) for generated payload cards. */
  async function handleOutputClick(event) {
    const button = event.target.closest("[data-copy-payload]");
    if (!button) {
      return;
    }
    const code = button.closest(".payload-card")?.querySelector("code");
    if (!code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code.textContent);
    } catch {
      return;
    }
    const label = button.querySelector(".icon-button__label");
    const icon = button.querySelector(".icon");
    const previous = label.textContent;
    label.textContent = "Copied";
    icon.classList.remove("icon-copy-bold");
    icon.classList.add("icon-check-circle-bold");
    window.setTimeout(() => {
      label.textContent = previous;
      icon.classList.remove("icon-check-circle-bold");
      icon.classList.add("icon-copy-bold");
    }, 1600);
  }

  renderResourceOptions();
  syncCustomFields();

  p.resourceList.addEventListener("change", syncCustomFields);
  p.form.addEventListener("submit", generatePayloads);
  p.output.addEventListener("click", handleOutputClick);
  wireRevealToggle(p.toggleSecretBtn, p.sharedSecret, "secret");
})();

/**
 * Theme selector: toggles the menu and applies System / Light / Dark themes.
 * Light/Dark are persisted via the URL hash (read by the inline boot script),
 * while System clears the hash and follows the OS preference.
 */
(function initThemeSelect() {
  const root = document.documentElement;
  const select = document.getElementById("theme-select");
  const button = document.getElementById("theme-select-button");
  const menu = document.getElementById("theme-select-menu");
  const label = document.getElementById("theme-select-label");
  const currentIcon = document.getElementById("theme-select-current-icon");

  if (!select || !button || !menu || !label || !currentIcon) {
    return;
  }

  const options = Array.from(menu.querySelectorAll(".theme-select-option"));

  const META = {
    system: { label: "System", icon: "icon-laptop-regular" },
    light: { label: "Light", icon: "icon-brightness-high-filled" },
    dark: { label: "Dark", icon: "icon-quiet-hours-presence-filled" },
  };
  const ICON_CLASSES = Object.values(META).map((meta) => meta.icon);

  const readChoice = () => {
    const raw = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const theme = raw ? new URLSearchParams(raw).get("theme") : null;
    return theme === "light" || theme === "dark" ? theme : "system";
  };

  const applyTheme = (choice) => {
    const dark =
      choice === "dark" ||
      (choice === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    root.classList.remove(
      "mds-theme-stable-lightWebex",
      "mds-theme-stable-darkWebex",
    );
    root.classList.add(
      dark ? "mds-theme-stable-darkWebex" : "mds-theme-stable-lightWebex",
    );
    root.style.colorScheme = dark ? "dark" : "light";
  };

  const syncButton = (choice) => {
    const meta = META[choice] || META.system;
    label.textContent = meta.label;
    currentIcon.classList.remove(...ICON_CLASSES);
    currentIcon.classList.add(meta.icon);
    options.forEach((option) => {
      option.setAttribute(
        "aria-selected",
        String(option.dataset.themeChoice === choice),
      );
    });
  };

  const setChoice = (choice) => {
    if (choice === "system") {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    } else {
      window.location.hash = "theme=" + choice;
    }
    applyTheme(choice);
    syncButton(choice);
  };

  const openMenu = () => {
    menu.hidden = false;
    select.dataset.open = "true";
    button.setAttribute("aria-expanded", "true");
  };

  const closeMenu = () => {
    menu.hidden = true;
    select.dataset.open = "false";
    button.setAttribute("aria-expanded", "false");
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  options.forEach((option) => {
    option.addEventListener("click", () => {
      setChoice(option.dataset.themeChoice);
      closeMenu();
      button.focus();
    });
  });

  document.addEventListener("click", (event) => {
    if (!select.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      closeMenu();
      button.focus();
    }
  });

  syncButton(readChoice());
})();

/**
 * Screenshot mode: when the URL hash carries a recognised `view`, arrange the
 * DOM with static fixtures so headless Chrome can capture each app state
 * without a live Webex connection. Driven entirely through the DOM and the
 * events the app already listens for, so no production code paths change. See
 * scripts/screenshot-mock.js and scripts/screenshot-web.mjs.
 */
(function initScreenshotMode() {
  const view = parseScreenshotViewFromHash();
  if (!view) {
    return;
  }

  const root = document.documentElement;
  root.classList.add("screenshot-mode");
  root.setAttribute("data-screenshot-view", view);

  /** Activates a top-level tab by its target panel id. */
  const showTabByPanel = (panelId) => {
    document.querySelectorAll(".tab").forEach((tab) => {
      const selected = tab.dataset.tabTarget === panelId;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(tab.dataset.tabTarget);
      if (panel) {
        panel.hidden = !selected;
      }
    });
  };

  /** Checks the payload resources matching `resources`, then fires change so
   *  the generator shows/hides its per-resource customization fields. */
  const selectPayloadResources = (resources) => {
    const list = document.getElementById("payloadResourceList");
    if (!list) {
      return;
    }
    list.querySelectorAll(".resource-option__input").forEach((input) => {
      input.checked = resources.includes(input.dataset.resource);
    });
    list.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const setValue = (id, value) => {
    const node = document.getElementById(id);
    if (node) {
      node.value = value;
    }
  };

  /** Sets an inline customization field value by resource + field key. */
  const setCustomValue = (resource, key, value) => {
    const group = document
      .getElementById("payloadResourceList")
      ?.querySelector(`.resource-option-group[data-resource="${resource}"]`);
    const field = group?.querySelector(`[data-custom-key="${key}"]`);
    if (field) {
      field.value = value;
    }
  };

  switch (view) {
    case "enterToken": {
      showTabByPanel("panel-webhooks");
      els.tokenInput.value = MOCK_TOKEN;
      break;
    }

    case "connected":
    case "existingWebhooks":
    case "createWebhooks": {
      showTabByPanel("panel-webhooks");
      els.tokenInput.value = MOCK_TOKEN;
      setConnectedUi(true, MOCK_BOT);
      renderWebhooks(MOCK_WEBHOOKS);
      setStatus(
        els.webhookStatus,
        `${MOCK_WEBHOOKS.length} webhooks found.`,
        "success",
      );
      break;
    }

    case "generateTests": {
      showTabByPanel("panel-payloads");
      break;
    }

    case "customiseTest": {
      showTabByPanel("panel-payloads");
      selectPayloadResources(["messages", "attachmentActions"]);
      setCustomValue("messages", "messageText", MOCK_MESSAGE_MARKDOWN);
      setCustomValue("attachmentActions", "inputs", MOCK_ATTACHMENT_INPUTS);
      break;
    }

    case "exampleTextJson": {
      showTabByPanel("panel-payloads");
      setValue("sharedSecret", MOCK_SECRET);
      selectPayloadResources(["messages"]);
      setCustomValue("messages", "messageText", MOCK_MESSAGE_MARKDOWN);
      document.getElementById("payloadForm")?.requestSubmit();
      break;
    }

    default:
      break;
  }
})();
