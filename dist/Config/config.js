import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve('./Config/.env') });
export const JUP_API_KEY = process.env.JUP_API_KEY;
export const BASE_TOKEN_MINT = process.env.BASE_TOKEN_MINT ?? "";
export const BASE_TOKEN_SYMBOL = process.env.BASE_TOKEN_SYMBOL;
export const BASE_AMOUNT = Number(process.env.BASE_AMOUNT ?? 100);
export const SLIPPAGE_BPS = 50;
export const DELAY_MS = 1200;
export const TOKENS_FILE = "./data/tokens.json";
export const RESULTS_FOLDER = "./data/results";
export const BASE_TOKEN_DECIMALS = parseInt(process.env.BASE_TOKEN_DECIMALS ?? "9");
export const BASE_TOKEN_LAMPORTS_AMOUNT = 10 ** BASE_TOKEN_DECIMALS;
export const RPC_ENDPOINT = process.env.RPC_ENDPOINT;
//# sourceMappingURL=config.js.map