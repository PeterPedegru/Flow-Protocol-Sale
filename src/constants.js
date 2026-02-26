import { parseAbi, parseAbiItem } from "viem";

export const FLOW_API_BASE_URL = "https://api.flow.bid";
export const BANKR_API_BASE_URL = "https://api.bankr.bot";

export const DEFAULT_FLOW_AUCTION_ADDRESS =
  "0x942967af43ab0001dbb43eab2456a2a0daea45b6";

export const AUCTION_MANAGER_ADDRESS =
  "0xF762AC1553c29Ef36904F9E7F71C627766D878b4";

export const USDC_BASE_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export const BID_SUBMITTED_EVENT = parseAbiItem(
  "event BidSubmitted(address indexed auction,address indexed user,uint256 indexed bidId,uint256 maxPrice,uint128 amount)",
);

export const BID_SUBMITTED_EVENT_ABI = [BID_SUBMITTED_EVENT];

export const Q96 = 2n ** 96n;
export const USDC_DECIMALS = 6n;

export const BASE_BLOCK_SECONDS = 2;
export const PRE_BID_BLOCKS = 150n;

export const ERC20_MIN_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);
