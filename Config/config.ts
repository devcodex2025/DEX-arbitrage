import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve('./Config/.env') });

export const JUP_API_KEY: string | undefined = process.env.JUP_API_KEY;
export const BASE_TOKEN_MINT: string = process.env.BASE_TOKEN_MINT ?? "";
export const BASE_TOKEN_SYMBOL: string = process.env.BASE_TOKEN_SYMBOL ?? "SOL";
export const BASE_AMOUNT: number = Number(process.env.BASE_AMOUNT ?? 100);
export const SLIPPAGE_BPS: number = Number(process.env.SLIPPAGE_BPS ?? 50);
export const DELAY_MS: number = process.env.DELAY_MS ? parseInt(process.env.DELAY_MS) : 1200;
export const TOKENS_FILE: string = "./data/tokens.json";
export const RESULTS_FOLDER: string = "./data/results";
export const BASE_TOKEN_DECIMALS: number = parseInt(process.env.BASE_TOKEN_DECIMALS ?? "9");
export const BASE_TOKEN_LAMPORTS_AMOUNT: number = (10 ** BASE_TOKEN_DECIMALS);
export const RPC_ENDPOINT: string = process.env.RPC_ENDPOINT ?? "https://api.mainnet-beta.solana.com";
export const MAX_TOKEN_PAGES_SCAN: number = parseInt(process.env.MAX_TOKEN_PAGES_SCAN ?? "500");
export const LIQUIDITY_USD: number = parseInt(process.env.LIQUIDITY_USD ?? "1000");
export const BASE_AMOUNT_IN_LAMPORTS: number = (10 ** BASE_TOKEN_DECIMALS) * BASE_AMOUNT;