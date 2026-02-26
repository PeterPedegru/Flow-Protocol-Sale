import { EventEmitter } from "node:events";

import { getAddress } from "viem";

import { AUCTION_MANAGER_ADDRESS, BID_SUBMITTED_EVENT } from "./constants.js";
import { amountRawToUsdc, maxPriceQ96ToFdvUsd, phaseFromBlock } from "./math.js";

export class BidMonitor extends EventEmitter {
  constructor({
    publicClient,
    auctionAddress,
    totalSupplyRaw,
    startBlock,
    endBlock,
    pollMs,
  }) {
    super();
    this.publicClient = publicClient;
    this.auctionAddress = getAddress(auctionAddress);
    this.totalSupplyRaw = BigInt(totalSupplyRaw);
    this.startBlock = BigInt(startBlock);
    this.endBlock = BigInt(endBlock);
    this.pollMs = pollMs;

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

      const logs = await this.publicClient.getLogs({
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
