#!/usr/bin/env node

import readline from "node:readline";

import {
  createPublicClient,
  decodeEventLog,
  fallback,
  formatUnits,
  getAddress,
  http,
  isAddressEqual,
} from "viem";
import { base } from "viem/chains";

import { BankrClient } from "./bankr-client.js";
import { loadConfig } from "./config.js";
import {
  BASE_BLOCK_SECONDS,
  BID_SUBMITTED_EVENT_ABI,
  ERC20_MIN_ABI,
  USDC_BASE_ADDRESS,
} from "./constants.js";
import { FlowClient } from "./flow-client.js";
import {
  formatSeconds,
  formatUsd,
  maxPriceQ96ToFdvUsd,
  phaseFromBlock,
} from "./math.js";
import { BidMonitor } from "./monitor.js";

function toIsoNow() {
  return new Date().toISOString();
}

function summarizeMonitorError(error) {
  const msg = String(error?.message ?? error);
  if (
    /Status:\s*503/i.test(msg) ||
    /no backend is currently healthy/i.test(msg)
  ) {
    return "RPC ответил 503 (временная деградация). Монитор продолжает ретраи.";
  }
  if (/Status:\s*429/i.test(msg)) {
    return "RPC rate limit (429). Монитор продолжает ретраи.";
  }

  const firstLine = msg.split("\n")[0]?.trim();
  return firstLine || "неизвестная ошибка мониторинга";
}

function parsePositiveNumber(value, fieldName) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} должен быть положительным числом`);
  }
  return parsed;
}

function normalizeFlowTransaction(item) {
  const tx = item?.transaction ?? item;
  if (!tx?.to || !tx?.chainId) {
    throw new Error("Flow вернул некорректный объект транзакции");
  }

  const normalized = {
    to: tx.to,
    chainId: Number(tx.chainId),
    value: String(tx.value ?? "0"),
    data: tx.data ?? "0x",
  };

  if (tx.gas !== undefined) normalized.gas = String(tx.gas);
  if (tx.gasPrice !== undefined) normalized.gasPrice = String(tx.gasPrice);
  if (tx.maxFeePerGas !== undefined) {
    normalized.maxFeePerGas = String(tx.maxFeePerGas);
  }
  if (tx.maxPriorityFeePerGas !== undefined) {
    normalized.maxPriorityFeePerGas = String(tx.maxPriorityFeePerGas);
  }
  if (tx.nonce !== undefined) normalized.nonce = Number(tx.nonce);

  return normalized;
}

async function getOnchainBaseBalances(publicClient, walletAddress) {
  const [nativeRaw, usdcRaw] = await Promise.all([
    publicClient.getBalance({ address: walletAddress }),
    publicClient.readContract({
      address: getAddress(USDC_BASE_ADDRESS),
      abi: ERC20_MIN_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    }),
  ]);

  return {
    nativeRaw,
    usdcRaw,
    nativeBalance: Number(formatUnits(nativeRaw, 18)),
    usdcBalance: Number(formatUnits(usdcRaw, 6)),
  };
}

function printHelp() {
  console.log("");
  console.log("Команды:");
  console.log("  help                         - показать справку");
  console.log("  status                       - текущий статус аукциона и балансов");
  console.log("  bid <USDC> <maxFDV_USD>      - отправить бид");
  console.log("  quit                         - выйти");
  console.log("");
}

async function main() {
  const config = loadConfig();
  const bankr = new BankrClient(config.bankrApiKey);
  const flow = new FlowClient();

  const transport = config.rpcUrls.length === 1
    ? http(config.rpcUrls[0], {
      retryCount: 3,
      retryDelay: 300,
      timeout: 10_000,
    })
    : fallback(
      config.rpcUrls.map((url) =>
        http(url, {
          retryCount: 2,
          retryDelay: 250,
          timeout: 10_000,
        }),
      ),
      {
        rank: false,
      },
    );

  const publicClient = createPublicClient({
    chain: base,
    transport,
  });

  console.log(`${toIsoNow()} Инициализация...`);

  const me = await bankr.getMe();
  const evmWallet = me?.wallets?.find((w) => w.chain === "evm")?.address;
  if (!evmWallet) {
    throw new Error("Не удалось получить EVM-кошелек из Bankr /agent/me");
  }
  const walletAddress = getAddress(evmWallet);

  const launch = await flow.getLaunch(config.flowAuctionAddress);
  const currencyAddress = getAddress(launch.currency);
  if (!isAddressEqual(currencyAddress, getAddress(USDC_BASE_ADDRESS))) {
    throw new Error(
      `Аукцион использует не USDC: ${currencyAddress}. Этот бот v1 поддерживает только USDC-аукционы.`,
    );
  }

  const startBlock = BigInt(launch.startBlock);
  const endBlock = BigInt(launch.endBlock);
  const claimBlock = BigInt(launch.claimBlock);
  const totalSupplyRaw = BigInt(launch.totalSupply);

  console.log(`${toIsoNow()} Bankr wallet: ${walletAddress}`);
  console.log(
    `${toIsoNow()} Auction: ${config.flowAuctionAddress} (${launch.tokenSymbol})`,
  );
  console.log(
    `${toIsoNow()} Blocks: start=${startBlock} end=${endBlock} claim=${claimBlock}`,
  );
  if (launch.floorPrice) {
    const floorFdv = maxPriceQ96ToFdvUsd(BigInt(launch.floorPrice), totalSupplyRaw);
    console.log(`${toIsoNow()} Floor FDV (calc): $${formatUsd(floorFdv)}`);
  }

  const monitor = new BidMonitor({
    publicClient,
    auctionAddress: config.flowAuctionAddress,
    totalSupplyRaw,
    startBlock,
    endBlock,
    pollMs: config.pollMs,
    logRetries: config.monitorLogRetries,
    retryBaseMs: config.monitorRetryBaseMs,
  });

  monitor.on("bid", (event) => {
    console.log(
      `${event.time.toISOString()} ${event.blockNumber} ${event.txHash} ${event.bidder} ${event.bidId} ${event.amountUsdc.toFixed(6)} ${event.maxFdvUsd.toFixed(2)} ${event.phase}`,
    );
  });

  const lastMonitorError = {
    text: "",
    at: 0,
  };

  monitor.on("warn", (warning) => {
    console.warn(`${toIsoNow()} [monitor:warn] ${warning.message}`);
  });

  monitor.on("error", (error) => {
    const text = summarizeMonitorError(error);
    const now = Date.now();
    if (lastMonitorError.text === text && now - lastMonitorError.at < 15_000) {
      return;
    }
    lastMonitorError.text = text;
    lastMonitorError.at = now;
    console.error(`${toIsoNow()} [monitor:error] ${text}`);
  });

  await monitor.start();
  console.log(
    `${toIsoNow()} Мониторинг запущен (poll=${config.pollMs}ms). Формат: time block tx bidder bidId amountUSDC maxFDV phase`,
  );

  let commandInProgress = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  async function showStatus() {
    const [currentBlock, baseBalances] = await Promise.all([
      publicClient.getBlockNumber(),
      getOnchainBaseBalances(publicClient, walletAddress),
    ]);
    const phase = phaseFromBlock(currentBlock, startBlock, endBlock);

    console.log("");
    console.log(`status @ ${toIsoNow()}`);
    console.log(`  block: ${currentBlock}`);
    console.log(`  phase: ${phase}`);
    if (currentBlock < startBlock) {
      const eta = Number(startBlock - currentBlock) * BASE_BLOCK_SECONDS;
      console.log(`  starts in: ~${formatSeconds(eta)}`);
    } else if (currentBlock <= endBlock) {
      const eta = Number(endBlock - currentBlock) * BASE_BLOCK_SECONDS;
      console.log(`  ends in: ~${formatSeconds(eta)}`);
    } else {
      console.log("  auction ended");
    }
    console.log(`  wallet: ${walletAddress}`);
    console.log(`  ETH(base): ${baseBalances.nativeBalance}`);
    console.log(`  USDC(base): ${baseBalances.usdcBalance}`);
    console.log("");
  }

  async function submitBid(amountUsdc, maxFdvUsd) {
    const currentBlock = await publicClient.getBlockNumber();
    const phase = phaseFromBlock(currentBlock, startBlock, endBlock);
    if (phase === "before_start") {
      throw new Error(
        `Аукцион еще не начался. Текущий блок ${currentBlock}, старт ${startBlock}.`,
      );
    }
    if (phase === "ended") {
      throw new Error(
        `Аукцион уже завершен. Текущий блок ${currentBlock}, конец ${endBlock}.`,
      );
    }

    const baseBalances = await getOnchainBaseBalances(publicClient, walletAddress);

    if (baseBalances.usdcBalance < amountUsdc) {
      throw new Error(
        `Недостаточно USDC. Нужно ${amountUsdc}, доступно ${baseBalances.usdcBalance}.`,
      );
    }
    if (baseBalances.nativeBalance < config.minNativeEth) {
      throw new Error(
        `Недостаточно ETH на газ. Нужно минимум ${config.minNativeEth}, доступно ${baseBalances.nativeBalance}.`,
      );
    }

    const build = await flow.buildBidTransactions({
      bidder: walletAddress,
      auctionAddress: config.flowAuctionAddress,
      amount: amountUsdc,
      maxFdvUsd,
    });

    const txs = Array.isArray(build?.transactions) ? build.transactions : [];
    if (txs.length === 0) {
      throw new Error("Flow /bids/build-tx не вернул транзакции");
    }

    console.log(`${toIsoNow()} build-tx ok (${txs.length} tx)`);

    const submittedHashes = [];
    for (let i = 0; i < txs.length; i += 1) {
      const flowTx = normalizeFlowTransaction(txs[i]);
      const description =
        txs[i]?.description ?? `Flow bid tx ${i + 1}/${txs.length}`;

      const result = await bankr.submitTx({
        transaction: flowTx,
        description,
        waitForConfirmation: true,
      });

      if (!result?.success || !result?.transactionHash) {
        throw new Error(
          `Bankr submit вернул неожиданный результат на tx ${i + 1}/${txs.length}`,
        );
      }

      submittedHashes.push(result.transactionHash);
      if (i === 0 && txs.length > 1) {
        console.log(`${toIsoNow()} submit approve ok ${result.transactionHash}`);
      } else if (i === txs.length - 1) {
        console.log(`${toIsoNow()} submit bid ok ${result.transactionHash}`);
      } else {
        console.log(`${toIsoNow()} submit step ok ${result.transactionHash}`);
      }
    }

    const bidTxHash = submittedHashes[submittedHashes.length - 1];
    const receipt = await publicClient.getTransactionReceipt({ hash: bidTxHash });

    let detectedBidId = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: BID_SUBMITTED_EVENT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (
          decoded?.eventName === "BidSubmitted" &&
          isAddressEqual(getAddress(decoded.args.auction), config.flowAuctionAddress) &&
          isAddressEqual(getAddress(decoded.args.user), walletAddress)
        ) {
          detectedBidId = decoded.args.bidId.toString();
          break;
        }
      } catch {
        // игнорируем логи других событий
      }
    }

    if (detectedBidId) {
      console.log(
        `${toIsoNow()} build-tx ok -> submit approve ok -> submit bid ok -> bidId detected (${detectedBidId})`,
      );
    } else {
      console.log(
        `${toIsoNow()} bid отправлен, но bidId в receipt не найден. tx=${bidTxHash}`,
      );
    }
  }

  async function handleCommand(rawLine) {
    const line = rawLine.trim();
    if (!line) return;

    const [command, ...args] = line.split(/\s+/);

    if (command === "help") {
      printHelp();
      return;
    }
    if (command === "quit" || command === "exit") {
      monitor.stop();
      rl.close();
      return;
    }
    if (command === "status") {
      await showStatus();
      return;
    }
    if (command === "bid") {
      if (args.length !== 2) {
        throw new Error("Формат: bid <USDC> <maxFDV_USD>");
      }
      const amountUsdc = parsePositiveNumber(args[0], "USDC amount");
      const maxFdvUsd = parsePositiveNumber(args[1], "max FDV");
      await submitBid(amountUsdc, maxFdvUsd);
      return;
    }

    throw new Error(`Неизвестная команда: ${command}`);
  }

  printHelp();
  rl.setPrompt("> ");
  rl.prompt();

  rl.on("line", async (line) => {
    if (commandInProgress) {
      console.log("Предыдущая команда ещё выполняется, подожди завершения.");
      rl.prompt();
      return;
    }

    commandInProgress = true;
    try {
      await handleCommand(line);
    } catch (error) {
      console.error(`${toIsoNow()} [command:error] ${error.message}`);
    } finally {
      commandInProgress = false;
      if (rl.listenerCount("line") > 0) {
        rl.prompt();
      }
    }
  });

  rl.on("close", () => {
    monitor.stop();
    console.log(`${toIsoNow()} Выход.`);
    process.exit(0);
  });

  process.on("SIGINT", () => {
    monitor.stop();
    rl.close();
  });
}

main().catch((error) => {
  console.error(`${toIsoNow()} [fatal] ${error.message}`);
  process.exit(1);
});
