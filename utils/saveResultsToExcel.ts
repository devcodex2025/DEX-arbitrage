import fs from "fs";
import path from "path";
import XLSX from "xlsx";

/**
 * Зберігає результати у Excel, з кольоровим форматуванням
 * @param {Array} results - масив результатів арбітражу
 * @param {string} resultsFolder - шлях до папки для збереження
 */
export function saveResultsToExcel(results, resultsFolder) {
  if (!results || results.length === 0) {
    console.log("⚠️ No results to save.");
    return;
  }

  // 🔹 Сортуємо: спочатку прибуткові → потім збиткові
  const sorted = [...results].sort((a, b) => b.profitPercent - a.profitPercent);

  // 🔹 Формуємо дані для таблиці
  const data = [
    ["Pair", "Buy (Lamports)", "Sell (Lamports)", "Profit %", "Token Amount", "Sell Display", "Source"],
  ];

  for (const r of sorted) {
    data.push([
      r.pair,
      r.buyAmount_lamports,
      r.sellAmount_lamports,
      r.profitPercent,
      r.tokenAmount_display,
      r.sellAmount_display,
      r.source,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);

  // 🔹 Додаємо кольори
  sorted.forEach((r, i) => {
    const cellAddress = `D${i + 2}`; // Колонка "Profit %"
    const profit = parseFloat(r.profitPercent);

    let color = "FFFFFF"; // Білий за замовчуванням
    if (profit > 1) color = "00FF00";       // Зелений
    else if (profit > 0) color = "CCFF99";  // Світло-зелений
    else if (profit > -1) color = "FFFF99"; // Жовтий
    else color = "FF9999";                  // Червоний

    if (!ws[cellAddress]) ws[cellAddress] = {};
    ws[cellAddress].s = {
      fill: { fgColor: { rgb: color } },
      alignment: { horizontal: "center" },
      numFmt: "0.00",
    };
  });

  // 🔹 Створюємо книгу
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Arbitrage Results");

  // 🔹 Переконуємося, що папка існує
  if (!fs.existsSync(resultsFolder)) fs.mkdirSync(resultsFolder, { recursive: true });

  const filePath = path.join(resultsFolder, `Tokens_spread_${Date.now()}.xlsx`);
  XLSX.writeFile(wb, filePath);

  console.log(`\n✅ Results saved: ${filePath}`);
}
