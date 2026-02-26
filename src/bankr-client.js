import { BANKR_API_BASE_URL } from "./constants.js";
import { HttpError } from "./http-error.js";

export class BankrClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async request(path, { method = "GET", query, body } = {}) {
    const url = new URL(path, BANKR_API_BASE_URL);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const rawText = await response.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = { rawText };
    }

    if (!response.ok) {
      const message =
        data?.message ||
        data?.error ||
        `Bankr API error: ${response.status} ${response.statusText}`;
      throw new HttpError(message, {
        status: response.status,
        data,
        method,
        url: url.toString(),
      });
    }

    return data;
  }

  async getMe() {
    return this.request("/agent/me");
  }

  async getBalances(chains = "base") {
    return this.request("/agent/balances", { query: { chains } });
  }

  async submitTx({ transaction, description, waitForConfirmation = true }) {
    return this.request("/agent/submit", {
      method: "POST",
      body: {
        transaction,
        description,
        waitForConfirmation,
      },
    });
  }
}
