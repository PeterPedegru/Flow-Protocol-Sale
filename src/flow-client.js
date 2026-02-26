import { FLOW_API_BASE_URL } from "./constants.js";
import { HttpError } from "./http-error.js";

export class FlowClient {
  async request(path, { method = "GET", body } = {}) {
    const url = new URL(path, FLOW_API_BASE_URL);

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
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
        `Flow API error: ${response.status} ${response.statusText}`;
      throw new HttpError(message, {
        status: response.status,
        data,
        method,
        url: url.toString(),
      });
    }

    return data;
  }

  async getLaunch(auctionAddress) {
    return this.request(`/launches/${auctionAddress}`);
  }

  async buildBidTransactions({
    walletAddress,
    auctionAddress,
    amount,
    maxFdvUsd,
    currencyPriceUsd,
  }) {
    const body = {
      walletAddress,
      auctionAddress,
      amount,
      maxFdvUsd,
    };

    if (currencyPriceUsd !== undefined && currencyPriceUsd !== null) {
      body.currencyPriceUsd = currencyPriceUsd;
    }

    return this.request("/bids/build-tx", {
      method: "POST",
      body,
    });
  }
}
