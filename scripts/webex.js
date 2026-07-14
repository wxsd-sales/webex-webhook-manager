import Http from "./http.js";

class Webex {
  #http;

  /**
   * Creates instance of Webex API Integration
   * @param {string} accessToken - Required auth
   * @param {?URL} baseUrl
   */
  constructor(accessToken, baseUrl = "https://webexapis.com/v1") {
    if (
      !accessToken ||
      typeof accessToken !== "string" ||
      !accessToken.trim()
    ) {
      throw new Error("Access token is required");
    }

    if (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim()) {
      throw new Error("Base URL is required");
    }

    this.#http = new Http(accessToken, baseUrl);

 
  }

  /**
   * List all of your webhooks.
   * @param {?object} params - Optional: params for the request
   * @param {?number} params.max - Optional: Limit the maximum number of webhooks in the response. example = "100", default = 100
   * @param {?string} params.ownedBy - Optional: Limit the result list to org wide webhooks. Only allowed value is org.example = "org"
   */
  async listWebhooks(params = {}, onProgress = null, onComplete = null) {
    console.log("Listing Webhooks");
    return this.#http.getPaginated("/webhooks", params, {
      onProgress,
      onComplete,
    });
  }

  /**
   * Update a webhook
   * @param {string} webhookId - The unique identifier for the webhook. example = "Y2lzY29zcGFyazovL3VzL1dFQkhPT0svOTZhYmMyYWEtM2RjYy0xMWU1LWExNTItZmUzNDgxOWNkYzlh"
   * @param {object} params - Params for the request
   * @param {string} params.name - A user-friendly name for the webhook.
   * @param {string} params.targetUrl - URL that receives POST requests for each event.
   * @param {?string} params.secret - Optional: Secret used to generate payload signature.
   * @param {?string} params.ownedBy - Optional: Specify org when creating an org/admin level webhook.
   * @param {?string} params.status - Optional: Status of the webhook. Use "active" to reactivate a disabled webhook.
   */
  async updateWebhook(webhookId, params = {}) {
    console.log("Updating Webhook Id:", webhookId);
    return this.#http.put("/webhooks/" + webhookId, params);
  }

  /**
   * Deletes a webhook, by ID.
   * @param {string} webhookId - The unique identifier for the webhook. example = "Y2lzY29zcGFyazovL3VzL1dFQkhPT0svOTZhYmMyYWEtM2RjYy0xMWU1LWExNTItZmUzNDgxOWNkYzlh"
   */
  async deleteWebhook(webhookId) {
    console.log("Deleting Webhook Id:", webhookId);
    return this.#http.delete("/webhooks/" + webhookId);
  }

  /**
   * Create a Webhook
   * @param {object} params - Optional: params for the request
   * @param {string} params.name - A user-friendly name for the webhook.
   * @param {string} params.targetUrl - URL that receives POST requests for each event.
   * @param {string} params.resource - Resource type for the webhook - ["attachmentActions", "dataSources", "memberships", "messages", "rooms", ...]
   * @param {string} params.event - Event type for the webhook - ["created", "updated", "deleted", "started", "ended", ...]
   * @param {string} params.filter - Optional: Filter that defines the webhook scope.
   * @param {?string} params.secret - Optional: Secret used to generate payload signature.
   * @param {?string} params.ownedBy - Optional: Specify org when creating an org/admin level webhook.
   */
  async createWebhook(params = {}) {
    console.log("Creating Webhook");
    return this.#http.post("/webhooks", params);
  }

  /**
   * Post a plain text or rich text message, and optionally, a file attachment attachment, to a room.
   * @param {object} params - Optional: params for the request
   * @param {?string} params.roomId - Optional: The room ID of the message.
   * @param {?string} params.parentId - Optional: The parent message to reply to.
   * @param {?string} params.toPersonId - Optional: The person ID of the recipient when sending a private 1:1 message.
   * @param {?string} params.toPersonEmail - Optional: The email address of the recipient when sending a private 1:1 message.
   * @param {?string} params.text - Optional: The message, in plain text. If markdown is specified this parameter may be optionally used to provide alternate text for UI clients that do not support rich text. The maximum message length is 7439 bytes.
   * @param {?string} params.markdown - Optional: The message, in Markdown format. The maximum message length is 7439 bytes.
   * @param {?string[]} params.files - Optional: The public URL to a binary file to be posted into the room. Only one file is allowed per message. Uploaded files are automatically converted into a format that all Webex clients can render.
   * @param {?object[]} params.attachments - Optional: Content attachments to attach to the message. Only one card per message is supported. See the Cards Guide for more information.
   */
  async createMessage(params = {}) {
    console.log("Creating Message");
    return this.#http.post("/messages", params);
  }

  /**
   * Show details for a message, by message ID.
   * @param {string} messageId - The unique identifier for the message. example = "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvOTJkYjNiZTAtNDNiZC0xMWU2LThhZTktZGQ1YjNkZmM1NjVk"
   */
  async getMessage(messageId) {
    console.log("Creating Message");
    return this.#http.getJson("/messages/" + messageId);
  }

  /**
   * Update a message you have posted not more than 10 times.
   * @param {string} messageId - Optional: params for the request
   * @param {object} params - Optional: params for the request
   * @param {?string} params.text - Optional: The message, in plain text. If markdown is specified this parameter may be optionally used to provide alternate text for UI clients that do not support rich text. The maximum message length is 7439 bytes.
   * @param {?string} params.markdown - Optional: The message, in Markdown format. The maximum message length is 7439 bytes.
   * @param {?object[]} params.attachments - Optional: Content attachments to attach to the message. Only one card per message is supported. See the Cards Guide for more information.
   */
  async editMessage(messageId, params = {}) {
    console.log("Creating Message");
    return this.#http.put("/messages/" + messageId, params);
  }

  /**
   * Delete a message, by message ID
   * @param {string} messageId - The unique identifier for the message. example = "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvOTJkYjNiZTAtNDNiZC0xMWU2LThhZTktZGQ1YjNkZmM1NjVk"
   */
  async deleteMessage(messageId, params = {}) {
    console.log("Creating Message");
    return this.#http.delete("/messages/" + messageId);
  }

  /**
   * Get profile details for the authenticated user.
   * @param {string} messageId - The unique identifier for the message. example = "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvOTJkYjNiZTAtNDNiZC0xMWU2LThhZTktZGQ1YjNkZmM1NjVk"
   */
  async getMyOwnDetails() {
    console.log("Getting my own details");
    return this.#http.getJson("/people/me");
  }

  /**
   * Shows details for a person, by ID.
   * @param {string} personId - A unique identifier for the person.example = "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9mNWIzNjE4Ny1jOGRkLTQ3MjctOGIyZi1mOWM0NDdmMjkwNDY"
   * @param {object} params - Optional: params for the request
   * @param {?boolean} params.callingData - Optional: Include Webex Calling user details in the response. true or false
   */
  async getPersonDetails(personId) {
    console.log("Getting Person Details");
    return this.#http.getJson("/people/" + personId);
  }

  /**
   * Shows details for a attachment action, by ID.
   * @param {string} actionId - A unique identifier for the attachment action.
   */
  async getActionDetails(actionId) {
    console.log("Creating Message");
    return this.#http.getJson("/attachment/actions/" + actionId);
  }
}

export default Webex;
