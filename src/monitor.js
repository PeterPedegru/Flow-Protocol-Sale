import { EventEmitter } from "node:events";

import { getAddress } from "viem";

import { AUCTION_MANAGER_ADDRESS, BID_SUBMITTED_EVENT } from "./constants.js";
import { amountRawToUsdc, maxPriceQ96ToFdvUsd, phaseFromBlock } from "./math.js";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecoverableRpcError(error) {
  const msg = String(error?.message ?? error);
  return (
    /Status:\s*503/i.test(msg) ||
    /Status:\s*429/i.test(msg) ||
    /no backend is currently healthy/i.test(msg) ||
    /timeout/i.test(msg) ||
    /network/i.test(msg) ||
    /ECONNRESET/i.test(msg)
  );
}

export class BidMonitor extends EventEmitter {
  constructor({
    publicClient,
    auctionAddress,
    totalSupplyRaw,
    startBlock,
    endBlock,
    pollMs,
    logRetries = 3,
    retryBaseMs = 300,
  }) {
    super();
    this.publicClient = publicClient;
    this.auctionAddress = getAddress(auctionAddress);
    this.totalSupplyRaw = BigInt(totalSupplyRaw);
    this.startBlock = BigInt(startBlock);
    this.endBlock = BigInt(endBlock);
    this.pollMs = pollMs;
    this.logRetries = logRetries;
    this.retryBaseMs = retryBaseMs;

    this.lastProcessedBlock = null;
    this.pollTimer = null;
    this.pollInProgress = false;
    this.seenLogIds = new Set();
  }

  async start() {
    if (this.pollTimer) return;
    const currentBlock = await this.publicClient.getBlockNumber();
    this.lastProcessedBlock = currentBlock > 0n ? currentBlock - 1n : 0n;

    this.pollTimer = setInterval(() => {
      this.poll().catch((error) => this.emit("error", error));
    }, this.pollMs);

    this.emit("started", { fromBlock: this.lastProcessedBlock + 1n });
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.emit("stopped");
    }
  }

  async getLogsWithRetry(params) {
    let attempt = 0;
    while (true) {
      try {
        return await this.publicClient.getLogs(params);
      } catch (error) {
        attempt += 1;

        if (!isRecoverableRpcError(error) || attempt > this.logRetries) {
          throw error;
        }

        const delayMs = Math.min(this.retryBaseMs * 2 ** (attempt - 1), 3000);
        this.emit("warn", {
          type: "rpc_retry",
          attempt,
          delayMs,
          message: `RPC временно недоступен, повтор через ${delayMs}ms`,
        });
        await sleep(delayMs);
      }
    }
  }

  async poll() {
    if (this.pollInProgress) return;
    this.pollInProgress = true;

    try {
      const currentBlock = await this.publicClient.getBlockNumber();
      if (this.lastProcessedBlock === null) {
        this.lastProcessedBlock = currentBlock > 0n ? currentBlock - 1n : 0n;
      }

      if (currentBlock <= this.lastProcessedBlock) return;

      const fromBlock = this.lastProcessedBlock + 1n;
      const toBlock = currentBlock;

      const logs = await this.getLogsWithRetry({
        address: AUCTION_MANAGER_ADDRESS,
        event: BID_SUBMITTED_EVENT,
        args: { auction: this.auctionAddress },
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        const logId = `${log.transactionHash}:${log.logIndex?.toString() ?? "0"}`;
        if (this.seenLogIds.has(logId)) continue;
        this.seenLogIds.add(logId);

        const amountRaw = BigInt(log.args.amount);
        const maxPriceQ96 = BigInt(log.args.maxPrice);
        const blockNumber = BigInt(log.blockNumber);

        this.emit("bid", {
          time: new Date(),
          blockNumber,
          txHash: log.transactionHash,
          bidder: getAddress(log.args.user),
          bidId: BigInt(log.args.bidId),
          amountRaw,
          amountUsdc: amountRawToUsdc(amountRaw),
          maxPriceQ96,
          maxFdvUsd: maxPriceQ96ToFdvUsd(maxPriceQ96, this.totalSupplyRaw),
          phase: phaseFromBlock(blockNumber, this.startBlock, this.endBlock),
        });
      }

      this.lastProcessedBlock = currentBlock;
      this.emit("synced", {
        fromBlock,
        toBlock,
        logsCount: logs.length,
      });
    } finally {
      this.pollInProgress = false;
    }
  }
}
