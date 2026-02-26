import "dotenv/config";

import { getAddress, isAddress } from "viem";

import { DEFAULT_FLOW_AUCTION_ADDRESS } from "./constants.js";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Отсутствует обязательная переменная окружения: ${name}`);
  }
  return value.trim();
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Ожидалось положительное целое число, получено: ${value}`);
  }
  return parsed;
}

function parsePositiveFloat(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Ожидалось положительное число, получено: ${value}`);
  }
  return parsed;
}

function parseUrlsCsv(value) {
  if (!value || !value.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateUrl(url) {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    throw new Error(`Некорректный URL RPC: ${url}`);
  }
}

export function loadConfig() {
  const bankrApiKey = requiredEnv("BANKR_API_KEY");
  const baseRpcUrl = requiredEnv("BASE_RPC_URL");
  const fallbackUrls = parseUrlsCsv(process.env.BASE_RPC_FALLBACK_URLS);
  const rpcUrls = [...new Set([baseRpcUrl, ...fallbackUrls])];
  rpcUrls.forEach(validateUrl);

  const flowAuctionAddress =
    process.env.FLOW_AUCTION_ADDRESS?.trim() || DEFAULT_FLOW_AUCTION_ADDRESS;

  if (!isAddress(flowAuctionAddress)) {
    throw new Error(
      `Некорректный FLOW_AUCTION_ADDRESS: ${flowAuctionAddress}`,
    );
  }

  return {
    bankrApiKey,
    rpcUrls,
    flowAuctionAddress: getAddress(flowAuctionAddress),
    pollMs: parsePositiveInt(process.env.POLL_MS, 1000),
    minNativeEth: parsePositiveFloat(process.env.MIN_NATIVE_ETH, 0.0001),
    monitorLogRetries: parsePositiveInt(process.env.MONITOR_LOG_RETRIES, 3),
    monitorRetryBaseMs: parsePositiveInt(process.env.MONITOR_RETRY_BASE_MS, 300),
  };
}
