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
 * Allowed webhook filter keys per resource, describing how the create-form
 * filter builder renders each value control:
 *   - "lookup": id value; text input + Search that queries rooms/people
 *   - "enum":   fixed set of values shown in a dropdown
 *   - "bool":   true/false dropdown
 *   - "text":   free text (e.g. an email)
 *   - "mentioned": me | a specific person (person lookup)
 * See https://developer.webex.com/docs/api/v1/webhooks/create-a-webhook.
 */
const FILTER_SCHEMAS = {
  messages: [
    { key: "roomId", type: "lookup", entity: "room" },
    { key: "roomType", type: "enum", options: ["direct", "group"] },
    { key: "personId", type: "lookup", entity: "person" },
    { key: "personEmail", type: "text", placeholder: "person@example.com" },
    { key: "mentionedPeople", type: "mentioned" },
    { key: "hasFiles", type: "bool" },
    { key: "hasAttachments", type: "bool" },
  ],
  attachmentActions: [
    { key: "roomId", type: "lookup", entity: "room" },
    { key: "personId", type: "lookup", entity: "person" },
    { key: "personEmail", type: "text", placeholder: "person@example.com" },
  ],
  memberships: [
    { key: "roomId", type: "lookup", entity: "room" },
    { key: "roomType", type: "enum", options: ["direct", "group"] },
    { key: "personId", type: "lookup", entity: "person" },
    { key: "personEmail", type: "text", placeholder: "person@example.com" },
    { key: "isModerator", type: "bool" },
  ],
  rooms: [
    { key: "type", type: "enum", options: ["direct", "group"] },
    { key: "isLocked", type: "bool" },
  ],
};

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
 * Caches in-flight/resolved entity-name lookups so the same room/person/org id
 * appearing across several webhook filters is only fetched once. Values are the
 * lookup promises themselves.
 */
const entityNameCache = new Map();

/**
 * Resolves the human-friendly name for a filter entity id, using the Webex
 * lookup methods. Returns null when unavailable (no client, or the request
 * failed) so callers can fall back to showing just the id.
 * @param {"room"|"person"|"org"} type
 * @param {string} id
 * @returns {Promise<?string>}
 */
function resolveEntityName(type, id) {
  if (!webex || !id) {
    return Promise.resolve(null);
  }
  const key = `${type}:${id}`;
  if (entityNameCache.has(key)) {
    return entityNameCache.get(key);
  }
  const lookup = (async () => {
    try {
      if (type === "room") {
        return (await webex.getRoomDetails(id)).title || null;
      }
      if (type === "person") {
        return (await webex.getPersonDetails(id)).displayName || null;
      }
      if (type === "org") {
        return (await webex.getOrgDetails(id)).displayName || null;
      }
    } catch (error) {
      console.error(`Failed to resolve ${type} name`, error);
    }
    return null;
  })();
  entityNameCache.set(key, lookup);
  return lookup;
}

/**
 * Maps a webhook filter key to the entity type whose name can be resolved, or
 * null when the value should be shown as-is. `mentionedPeople=me` is a keyword,
 * not a person id, so it is left untouched.
 */
function filterEntityType(key, value) {
  switch (key) {
    case "roomId":
      return "room";
    case "personId":
      return "person";
    case "orgId":
      return "org";
    case "mentionedPeople":
      return value === "me" ? null : "person";
    default:
      return null;
  }
}

/**
 * Builds the DOM for a webhook filter value. The filter is a URL-search-params
 * style string (e.g. `roomId=...&mentionedPeople=me`). Resolvable ids keep the
 * (truncated) id visible with the resolved name appended once it loads.
 */
function buildFilterValue(filter) {
  const container = el("div", { class: "webhook-card__filter" });

  let entries = [];
  try {
    entries = Array.from(new URLSearchParams(filter).entries());
  } catch {
    entries = [];
  }

  if (!entries.length) {
    container.append(el("span", { class: "filter-param__text" }, filter));
    return container;
  }

  for (const [key, value] of entries) {
    const type = filterEntityType(key, value);
    let valueNode;

    if (type) {
      const nameSpan = el("span", { class: "filter-param__name" });
      if (webex) {
        nameSpan.textContent = "\u2026";
        resolveEntityName(type, value).then((name) => {
          nameSpan.textContent = name || "";
        });
      }
      valueNode = el("span", { class: "filter-param__value" }, [
        el("span", { class: "filter-param__id", title: value }, value),
        nameSpan,
      ]);
    } else {
      valueNode = el("span", { class: "filter-param__value" }, [
        el("span", { class: "filter-param__text" }, value),
      ]);
    }

    container.append(
      el("div", { class: "filter-param" }, [
        el("span", { class: "filter-param__key" }, key),
        valueNode,
      ]),
    );
  }

  return container;
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
      el("span", { class: "badge badge--resource" }, `Resource: ${hook.resource || "?"}`),
      el("span", { class: "badge badge--event" }, `Event: ${hook.event || "?"}`),
      hook.created
        ? el("span", { class: "badge badge--created" }, `Created ${formatDate(hook.created)}`)
        : null,
      el(
        "span",
        { class: `badge ${isActive ? "badge--active" : "badge--inactive"}` },
        hook.status || "active",
      ),
    ]);

    const details = el("dl", { class: "webhook-card__details" }, [
      el("div", { class: "webhook-card__detail" }, [
        el("dt", {}, "Target URL"),
        el("dd", {}, hook.targetUrl || "\u2014"),
      ]),
      hook.filter
        ? el("div", { class: "webhook-card__detail" }, [
            el("dt", {}, "Filter"),
            el("dd", {}, buildFilterValue(hook.filter)),
          ])
        : null,
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

    els.webhookList.append(el("div", { class: "webhook-card" }, [header, details]));
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

/**
 * Parses a Webex filter string into `[key, value]` pairs. Values are kept
 * verbatim (not URL-decoded) because Webex ids are base64 that can legitimately
 * contain `+`, `/` and `=` — decoding them would corrupt the value.
 */
function parseFilterString(raw) {
  return (raw || "")
    .split("&")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq === -1
        ? [pair, ""]
        : [pair.slice(0, eq), pair.slice(eq + 1)];
    });
}

/** Serialises `[key, value]` pairs back into a Webex filter string. */
function buildFilterString(pairs) {
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

/** Adds or replaces a single key in the raw filter input. */
function upsertFilterParam(rawInput, key, value) {
  const pairs = parseFilterString(rawInput.value);
  const existing = pairs.find(([k]) => k === key);
  if (existing) {
    existing[1] = value;
  } else {
    pairs.push([key, value]);
  }
  rawInput.value = buildFilterString(pairs);
}

/** Removes a key from the raw filter input. */
function removeFilterParam(rawInput, key) {
  rawInput.value = buildFilterString(
    parseFilterString(rawInput.value).filter(([k]) => k !== key),
  );
}

/** Renders the removable chips that mirror the raw filter string. */
function renderFilterChips(chips, rawInput) {
  const pairs = parseFilterString(rawInput.value);
  chips.replaceChildren(
    ...pairs.map(([key, value]) =>
      el("span", { class: "filter-chip" }, [
        el("span", { class: "filter-chip__key" }, key),
        el("span", { class: "filter-chip__value", title: value }, value || "\u2014"),
        el(
          "button",
          {
            type: "button",
            class: "filter-chip__remove",
            dataset: { removeKey: key },
            "aria-label": `Remove ${key} filter`,
          },
          [el("span", { class: "icon icon-cancel-regular", "aria-hidden": "true" })],
        ),
      ]),
    ),
  );
  chips.hidden = !pairs.length;
}

/**
 * Searches rooms (by title) or people (by name/email) and renders the results
 * into the lookup panel. Selecting a result stores its id on the input while
 * showing the friendly name, so ids never have to be copied by hand.
 */
async function performFilterLookup(entity, input, lookupPanel) {
  const term = (input.value || "").trim();
  const status = (message) =>
    lookupPanel.replaceChildren(
      el("p", { class: "resource-filter__lookup-status" }, message),
    );

  lookupPanel.hidden = false;

  if (!webex) {
    status("Connect a bot token to search.");
    return;
  }
  if (entity === "person" && !term) {
    status("Type a name or email to search.");
    return;
  }

  status("Searching\u2026");

  try {
    let results = [];
    if (entity === "room") {
      const rooms = await webex.listRooms({ max: 100 });
      const needle = term.toLowerCase();
      results = (rooms || [])
        .filter((room) => !needle || (room.title || "").toLowerCase().includes(needle))
        .slice(0, 25)
        .map((room) => ({
          id: room.id,
          name: room.title || "(untitled space)",
          sub: room.type || "",
        }));
    } else {
      const params = term.includes("@")
        ? { email: term, max: 20 }
        : { displayName: term, max: 20 };
      const people = await webex.listPeople(params);
      results = (people || []).slice(0, 25).map((person) => ({
        id: person.id,
        name: person.displayName || person.emails?.[0] || "(unknown person)",
        sub: person.emails?.[0] || "",
      }));
    }

    if (!results.length) {
      status("No matches found.");
      return;
    }

    const list = el(
      "ul",
      { class: "resource-filter__results" },
      results.map((result) => {
        const button = el("button", { type: "button", class: "resource-filter__result" }, [
          el("span", { class: "resource-filter__result-name" }, result.name),
          result.sub
            ? el("span", { class: "resource-filter__result-sub" }, result.sub)
            : null,
        ]);
        button.addEventListener("click", () => {
          input.value = result.name;
          input.dataset.selectedId = result.id;
          lookupPanel.hidden = true;
          lookupPanel.replaceChildren();
        });
        return el("li", {}, button);
      }),
    );
    lookupPanel.replaceChildren(list);
  } catch (error) {
    console.error(error);
    status(describeError(error));
  }
}

/** Builds a lookup control (text input + Search) for room/person id filters. */
function buildLookupControl(entity, lookupPanel) {
  const input = el("input", {
    type: "text",
    class: "field__input resource-filter__control resource-filter__lookup-input",
    autocomplete: "off",
    placeholder:
      entity === "room"
        ? "Search space name or paste a room ID"
        : "Search name/email or paste a person ID",
    dataset: { filterControl: "", lookupEntity: entity },
  });
  // Typing again invalidates a previously picked result so the text is treated
  // as a fresh search term (or a directly-pasted id).
  input.addEventListener("input", () => {
    delete input.dataset.selectedId;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      performFilterLookup(entity, input, lookupPanel);
    }
  });

  const searchBtn = el(
    "button",
    {
      type: "button",
      class: "icon-button icon-button--with-label secondary-button resource-filter__search",
    },
    [
      el("span", { class: "icon icon-search-regular", "aria-hidden": "true" }),
      el("span", { class: "icon-button__label" }, "Search"),
    ],
  );
  searchBtn.addEventListener("click", () =>
    performFilterLookup(entity, input, lookupPanel),
  );

  return el("div", { class: "resource-filter__lookup-control" }, [input, searchBtn]);
}

/** Renders the value control for the currently selected filter key. */
function renderFilterValueControl(valueWrap, lookupPanel, field) {
  valueWrap.replaceChildren();
  lookupPanel.hidden = true;
  lookupPanel.replaceChildren();

  if (!field) {
    return;
  }

  if (field.type === "enum" || field.type === "bool") {
    const options =
      field.type === "bool" ? ["true", "false"] : field.options;
    valueWrap.append(
      el(
        "select",
        { class: "field__input resource-filter__control", dataset: { filterControl: "" } },
        options.map((option) => el("option", { value: option }, option)),
      ),
    );
    return;
  }

  if (field.type === "text") {
    valueWrap.append(
      el("input", {
        type: "text",
        class: "field__input resource-filter__control",
        autocomplete: "off",
        placeholder: field.placeholder || "",
        dataset: { filterControl: "" },
      }),
    );
    return;
  }

  if (field.type === "lookup") {
    valueWrap.append(buildLookupControl(field.entity, lookupPanel));
    return;
  }

  if (field.type === "mentioned") {
    const personWrap = el("div", { class: "resource-filter__mentioned-person", hidden: true });
    const modeSelect = el(
      "select",
      { class: "field__input resource-filter__mode" },
      [
        el("option", { value: "me" }, "Me (the bot)"),
        el("option", { value: "person" }, "Specific person\u2026"),
      ],
    );
    modeSelect.addEventListener("change", () => {
      if (modeSelect.value === "person") {
        personWrap.hidden = false;
        personWrap.replaceChildren(buildLookupControl("person", lookupPanel));
      } else {
        personWrap.hidden = true;
        personWrap.replaceChildren();
        lookupPanel.hidden = true;
        lookupPanel.replaceChildren();
      }
    });
    valueWrap.append(
      el("div", { class: "resource-filter__mentioned" }, [modeSelect, personWrap]),
    );
  }
}

/** Reads the value the user entered/selected for the active filter key. */
function readFilterValue(valueWrap, field) {
  if (!field) {
    return "";
  }
  if (field.type === "mentioned") {
    const mode = valueWrap.querySelector(".resource-filter__mode");
    if (!mode || mode.value === "me") {
      return "me";
    }
    const input = valueWrap.querySelector(".resource-filter__lookup-input");
    return input ? (input.dataset.selectedId || input.value.trim()) : "";
  }
  const control = valueWrap.querySelector("[data-filter-control]");
  if (!control) {
    return "";
  }
  if (control.classList.contains("resource-filter__lookup-input")) {
    return control.dataset.selectedId || control.value.trim();
  }
  return typeof control.value === "string" ? control.value.trim() : control.value;
}

/** Builds the filter builder + raw-string block for a resource. */
function renderFilterBlock(schema, checked) {
  const keySelect = el(
    "select",
    { class: "field__input resource-filter__key" },
    [
      el("option", { value: "" }, "Add a filter\u2026"),
      ...schema.map((field) => el("option", { value: field.key }, field.key)),
    ],
  );
  const valueWrap = el("div", { class: "resource-filter__value" });
  const addBtn = el(
    "button",
    {
      type: "button",
      class: "icon-button icon-button--with-label secondary-button resource-filter__add",
      disabled: true,
    },
    [
      el("span", { class: "icon icon-plus-bold", "aria-hidden": "true" }),
      el("span", { class: "icon-button__label" }, "Add"),
    ],
  );
  const builder = el("div", { class: "resource-filter__builder" }, [
    keySelect,
    valueWrap,
    addBtn,
  ]);
  const lookupPanel = el("div", { class: "resource-filter__lookup", hidden: true });
  const chips = el("div", { class: "resource-filter__chips", hidden: true });
  const rawInput = el("input", {
    type: "text",
    class: "field__input resource-filter__raw",
    autocomplete: "off",
    spellcheck: false,
    placeholder: "roomId=...&mentionedPeople=me",
    dataset: { filterRaw: "" },
  });
  const rawField = el("div", { class: "field" }, [
    el("label", { class: "field__label" }, "Filter string (optional)"),
    rawInput,
    el(
      "span",
      { class: "field__hint" },
      "Standard Webex filter. Edit directly, or use the builder above to add keys.",
    ),
  ]);

  const filterEl = el("div", { class: "resource-filter", hidden: !checked }, [
    el("span", { class: "resource-filter__title" }, "Filters (optional)"),
    builder,
    lookupPanel,
    chips,
    rawField,
  ]);

  const refreshChips = () => renderFilterChips(chips, rawInput);

  keySelect.addEventListener("change", () => {
    const field = schema.find((entry) => entry.key === keySelect.value);
    renderFilterValueControl(valueWrap, lookupPanel, field);
    addBtn.disabled = !field;
  });

  addBtn.addEventListener("click", () => {
    const field = schema.find((entry) => entry.key === keySelect.value);
    if (!field) {
      return;
    }
    const value = readFilterValue(valueWrap, field);
    if (value === "" || value == null) {
      return;
    }
    upsertFilterParam(rawInput, field.key, value);
    refreshChips();
    keySelect.value = "";
    valueWrap.replaceChildren();
    lookupPanel.hidden = true;
    lookupPanel.replaceChildren();
    addBtn.disabled = true;
  });

  rawInput.addEventListener("input", refreshChips);

  chips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-key]");
    if (!button) {
      return;
    }
    removeFilterParam(rawInput, button.dataset.removeKey);
    refreshChips();
  });

  return filterEl;
}

/**
 * Builds the resource options. Each option is wrapped in a group so a filter
 * builder can sit inline beneath the toggle, matching the payload tab layout.
 */
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
    const option = el("label", { class: "resource-option", for: id }, [input, text]);

    const children = [option];
    const schema = FILTER_SCHEMAS[preset.resource];
    if (schema) {
      const filterEl = renderFilterBlock(schema, preset.checked);
      input.addEventListener("change", () => {
        filterEl.hidden = !input.checked;
      });
      children.push(filterEl);
    }

    els.resourceList.append(
      el(
        "div",
        {
          class: "resource-option-group",
          dataset: { resource: preset.resource, event: preset.event },
        },
        children,
      ),
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
  ).map((input) => {
    const group = input.closest(".resource-option-group");
    const rawFilter = group?.querySelector(".resource-filter__raw");
    return {
      resource: input.dataset.resource,
      event: input.dataset.event,
      filter: rawFilter ? rawFilter.value.trim() : "",
    };
  });

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
  for (const { resource, event: eventName, filter } of selected) {
    const params = {
      name: `${prefix} - ${resource}`,
      targetUrl,
      resource,
      event: eventName,
    };
    if (filter) {
      params.filter = filter;
    }
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
   * HMAC hex digest for the given hash algorithm. The chosen hash is dictated by
   * the Webex signature header being reproduced (SHA-1 for X-Spark-Signature,
   * SHA-256/SHA-512 for X-Webex-Signature), so these are required for
   * compatibility with Webex — not a free security choice. See the
   * developer.webex.com webhook docs.
   */
  async function signHmacHex(secret, message, hash) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash },
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
   * Computes the signature headers Webex sends alongside a webhook delivery:
   * - `x-spark-signature`: HMAC-SHA1 hex digest of the raw body (legacy header).
   * - `x-webex-signature`: comma-separated HMAC-SHA256 and HMAC-SHA512 hex
   *   digests, formatted as "SHA-256=<hex>, SHA-512=<hex>" (current header).
   */
  async function buildSignatureHeaders(secret, message) {
    const [sha1, sha256, sha512] = await Promise.all([
      signHmacHex(secret, message, "SHA-1"),
      signHmacHex(secret, message, "SHA-256"),
      signHmacHex(secret, message, "SHA-512"),
    ]);
    return {
      "x-spark-signature": sha1,
      "x-webex-signature": `SHA-256=${sha256}, SHA-512=${sha512}`,
    };
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
   * 2.0) proxy event, with the signatures in the headers. The account id, api id
   * and domain are illustrative placeholders.
   */
  function buildLambdaEvent(bodyString, signatureHeaders) {
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
    if (signatureHeaders) {
      Object.assign(headers, signatureHeaders);
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
        const signatureHeaders = secret
          ? await buildSignatureHeaders(secret, bodyString)
          : null;
        const lambdaEvent = buildLambdaEvent(bodyString, signatureHeaders);
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
