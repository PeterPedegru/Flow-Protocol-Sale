import { PRE_BID_BLOCKS, Q96, USDC_DECIMALS } from "./constants.js";

export function amountRawToUsdc(amountRaw) {
  return Number(BigInt(amountRaw)) / 10 ** Number(USDC_DECIMALS);
}

export function maxPriceQ96ToFdvUsd(maxPriceQ96, totalSupplyRaw) {
  const fdvRawUsd6 =
    (BigInt(maxPriceQ96) * BigInt(totalSupplyRaw)) / Q96;
  return Number(fdvRawUsd6) / 10 ** Number(USDC_DECIMALS);
}

export function phaseFromBlock(blockNumber, startBlock, endBlock) {
  const block = BigInt(blockNumber);
  const start = BigInt(startBlock);
  const end = BigInt(endBlock);

  if (block < start) return "before_start";
  if (block <= start + PRE_BID_BLOCKS - 1n) return "pre_bid";
  if (block <= end) return "clearing";
  return "ended";
}

export function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatSeconds(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
