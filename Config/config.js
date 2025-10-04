import dotenv from "dotenv";
dotenv.config();

export const JUP_API_KEY = process.env.JUP_API_KEY;
export const BASE_TOKEN_MINT = process.env.BASE_TOKEN_MINT;
export const BASE_TOKEN_SYMBOL = process.env.BASE_TOKEN_SYMBOL;
export const BASE_AMOUNT = Number(process.env.BASE_AMOUNT || 100);
export const SLIPPAGE_BPS = 50;
export const DELAY_MS = 1200;
export const TOKENS_FILE = "./data/tokens.json";
export const RESULTS_FOLDER = "./results";
export const BASE_TOKEN_DECIMALS = parseInt(process.env.BASE_TOKEN_DECIMALS);
export const BASE_TOKEN_LAMPORTS = 10 ** BASE_TOKEN_DECIMALS;