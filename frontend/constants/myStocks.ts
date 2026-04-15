// ═══════════════════════════════════════════════════════════════════════
// Bursa Malaysia Stock List — 200+ major Bursa stocks by sector
// Yahoo Finance symbols (.KL suffix)
// ═══════════════════════════════════════════════════════════════════════

export type MYStock = {
  symbol: string;
  name: string;
  sector: string;
  /** Approximate reference price (MYR) */
  refPrice: number;
  /** Market cap tier: L=Large, M=Mid, S=Small */
  cap: "L" | "M" | "S";
  /** Default strategy for this stock (auto-selects on stock pick) */
  strategy?: "tpc" | "hpb" | "vpb3" | "smp";
};

export const MY_STOCKS: MYStock[] = [
  // ── Finance ───────────────────────────────────────────
  { symbol: "1155.KL", name: "Maybank", sector: "Finance", refPrice: 10.0, cap: "L" },
  { symbol: "1295.KL", name: "Public Bank", sector: "Finance", refPrice: 4.5, cap: "L" },
  { symbol: "1023.KL", name: "CIMB", sector: "Finance", refPrice: 8.0, cap: "L" },
  { symbol: "5819.KL", name: "Hong Leong Bank", sector: "Finance", refPrice: 21.0, cap: "L" },
  { symbol: "1066.KL", name: "RHB Bank", sector: "Finance", refPrice: 6.5, cap: "L" },
  { symbol: "1015.KL", name: "Ambank", sector: "Finance", refPrice: 5.0, cap: "M" },
  { symbol: "1082.KL", name: "Hong Leong Financial", sector: "Finance", refPrice: 20.0, cap: "L" },
  { symbol: "2488.KL", name: "Alliance Bank", sector: "Finance", refPrice: 4.0, cap: "M" },
  { symbol: "1818.KL", name: "Bursa Malaysia", sector: "Finance", refPrice: 8.5, cap: "M" },
  { symbol: "5185.KL", name: "AFFIN Bank", sector: "Finance", refPrice: 2.5, cap: "M" },
  { symbol: "8621.KL", name: "LPI Capital", sector: "Finance", refPrice: 13.0, cap: "M" },
  { symbol: "1171.KL", name: "MBSB", sector: "Finance", refPrice: 0.8, cap: "M" },
  { symbol: "5258.KL", name: "Bank Islam", sector: "Finance", refPrice: 2.5, cap: "M" },

  // ── Technology ────────────────────────────────────────
  { symbol: "5031.KL", name: "TIME dotCom", sector: "Technology", refPrice: 4.0, cap: "L" },
  { symbol: "0097.KL", name: "ViTrox", sector: "Technology", refPrice: 3.5, cap: "M" },
  { symbol: "0128.KL", name: "Frontken", sector: "Technology", refPrice: 4.0, cap: "M" },
  { symbol: "0166.KL", name: "Inari Amertron", sector: "Technology", refPrice: 3.0, cap: "L" },
  { symbol: "5005.KL", name: "Unisem", sector: "Technology", refPrice: 3.5, cap: "M" },
  { symbol: "5340.KL", name: "UMS Integration", sector: "Technology", refPrice: 1.5, cap: "M" },
  { symbol: "0270.KL", name: "Nationgate", sector: "Technology", refPrice: 2.0, cap: "M" },
  { symbol: "7100.KL", name: "Uchi Technologies", sector: "Technology", refPrice: 4.0, cap: "M" },
  { symbol: "4456.KL", name: "DNEX", sector: "Technology", refPrice: 0.5, cap: "S" },
  { symbol: "7233.KL", name: "Dufu Technology", sector: "Technology", refPrice: 2.5, cap: "S" },
  { symbol: "7160.KL", name: "Pentamaster", sector: "Technology", refPrice: 4.5, cap: "M" },
  { symbol: "3867.KL", name: "MPI", sector: "Technology", refPrice: 30.0, cap: "L" },
  { symbol: "9822.KL", name: "SAM Engineering", sector: "Technology", refPrice: 5.0, cap: "M" },
  { symbol: "5162.KL", name: "VSTECS", sector: "Technology", refPrice: 3.0, cap: "M" },
  { symbol: "5302.KL", name: "Aurelius Technologies", sector: "Technology", refPrice: 2.5, cap: "S" },

  // ── Industrial Products ───────────────────────────────
  { symbol: "8869.KL", name: "Press Metal", sector: "Industrial", refPrice: 5.5, cap: "L" },
  { symbol: "0208.KL", name: "Greatech", sector: "Industrial", refPrice: 3.0, cap: "M" },
  { symbol: "5292.KL", name: "UWC", sector: "Industrial", refPrice: 3.0, cap: "M" },
  { symbol: "5168.KL", name: "Hartalega", sector: "Industrial", refPrice: 2.0, cap: "L" },
  { symbol: "7153.KL", name: "Kossan Rubber", sector: "Industrial", refPrice: 1.5, cap: "M" },
  { symbol: "5286.KL", name: "Mi Technovation", sector: "Industrial", refPrice: 3.0, cap: "M" },
  { symbol: "0225.KL", name: "Southern Cable", sector: "Industrial", refPrice: 2.5, cap: "S" },
  { symbol: "6963.KL", name: "VS Industry", sector: "Industrial", refPrice: 1.0, cap: "M" },
  { symbol: "7172.KL", name: "PMB Technology", sector: "Industrial", refPrice: 1.5, cap: "S" },
  { symbol: "0233.KL", name: "Pekat Group", sector: "Industrial", refPrice: 1.0, cap: "S", strategy: "smp" },
  { symbol: "0167.KL", name: "MClean Technologies", sector: "Industrial", refPrice: 1.0, cap: "S" },

  // ── Telecommunications ────────────────────────────────
  { symbol: "6947.KL", name: "CelcomDigi", sector: "Telecom", refPrice: 3.5, cap: "L" },
  { symbol: "4863.KL", name: "Telekom Malaysia", sector: "Telecom", refPrice: 7.0, cap: "L" },
  { symbol: "6012.KL", name: "Maxis", sector: "Telecom", refPrice: 4.0, cap: "L" },
  { symbol: "6888.KL", name: "Axiata", sector: "Telecom", refPrice: 2.5, cap: "L" },
  { symbol: "0172.KL", name: "OCK Group", sector: "Telecom", refPrice: 0.8, cap: "S" },

  // ── Consumer ──────────────────────────────────────────
  { symbol: "5326.KL", name: "99 Speed Mart", sector: "Consumer", refPrice: 3.5, cap: "L" },
  { symbol: "4707.KL", name: "Nestle Malaysia", sector: "Consumer", refPrice: 120.0, cap: "L" },
  { symbol: "7084.KL", name: "QL Resources", sector: "Consumer", refPrice: 5.5, cap: "L" },
  { symbol: "5296.KL", name: "MR DIY", sector: "Consumer", refPrice: 2.0, cap: "L" },
  { symbol: "3689.KL", name: "Fraser & Neave", sector: "Consumer", refPrice: 25.0, cap: "L" },
  { symbol: "4715.KL", name: "Genting Malaysia", sector: "Consumer", refPrice: 3.0, cap: "L" },
  { symbol: "3182.KL", name: "Genting Bhd", sector: "Consumer", refPrice: 5.5, cap: "L" },
  { symbol: "5337.KL", name: "Eco-Shop", sector: "Consumer", refPrice: 1.5, cap: "M" },
  { symbol: "5306.KL", name: "Farm Fresh", sector: "Consumer", refPrice: 1.5, cap: "M" },
  { symbol: "7052.KL", name: "Padini", sector: "Consumer", refPrice: 4.0, cap: "M" },
  { symbol: "3255.KL", name: "Heineken Malaysia", sector: "Consumer", refPrice: 25.0, cap: "M" },
  { symbol: "2836.KL", name: "Carlsberg", sector: "Consumer", refPrice: 22.0, cap: "M" },
  { symbol: "4065.KL", name: "PPB Group", sector: "Consumer", refPrice: 15.0, cap: "L" },
  { symbol: "3026.KL", name: "Dutch Lady", sector: "Consumer", refPrice: 28.0, cap: "M" },
  { symbol: "5248.KL", name: "Bermaz Auto", sector: "Consumer", refPrice: 2.0, cap: "M" },

  // ── Healthcare ────────────────────────────────────────
  { symbol: "5225.KL", name: "IHH Healthcare", sector: "Healthcare", refPrice: 7.0, cap: "L" },
  { symbol: "5555.KL", name: "Sunway Healthcare", sector: "Healthcare", refPrice: 3.0, cap: "M" },
  { symbol: "5878.KL", name: "KPJ Healthcare", sector: "Healthcare", refPrice: 1.5, cap: "M" },
  { symbol: "7113.KL", name: "Top Glove", sector: "Healthcare", refPrice: 1.0, cap: "L" },
  { symbol: "5318.KL", name: "DXN Holdings", sector: "Healthcare", refPrice: 0.5, cap: "M" },
  { symbol: "7148.KL", name: "Duopharma Biotech", sector: "Healthcare", refPrice: 1.5, cap: "S" },
  { symbol: "0101.KL", name: "TMC Life Sciences", sector: "Healthcare", refPrice: 0.8, cap: "S" },

  // ── Construction ──────────────────────────────────────
  { symbol: "5211.KL", name: "Sunway Bhd", sector: "Construction", refPrice: 4.0, cap: "L" },
  { symbol: "5398.KL", name: "Gamuda", sector: "Construction", refPrice: 8.0, cap: "L" },
  { symbol: "5263.KL", name: "Sunway Construction", sector: "Construction", refPrice: 3.0, cap: "M" },
  { symbol: "3336.KL", name: "IJM Corp", sector: "Construction", refPrice: 3.0, cap: "L" },
  { symbol: "0151.KL", name: "Kelington Group", sector: "Construction", refPrice: 2.5, cap: "M" },
  { symbol: "7161.KL", name: "Kerjaya Prospek", sector: "Construction", refPrice: 1.5, cap: "M" },
  { symbol: "1651.KL", name: "MRCB", sector: "Construction", refPrice: 0.5, cap: "M" },
  { symbol: "9679.KL", name: "WCT Holdings", sector: "Construction", refPrice: 0.8, cap: "M" },
  { symbol: "8877.KL", name: "Ekovest", sector: "Construction", refPrice: 0.5, cap: "S" },
  { symbol: "0215.KL", name: "Solarvest", sector: "Construction", refPrice: 1.0, cap: "S" },

  // ── Properties ────────────────────────────────────────
  { symbol: "5249.KL", name: "IOI Properties", sector: "Property", refPrice: 2.0, cap: "L" },
  { symbol: "5288.KL", name: "Sime Darby Property", sector: "Property", refPrice: 1.5, cap: "L" },
  { symbol: "8206.KL", name: "Eco World Development", sector: "Property", refPrice: 1.0, cap: "M" },
  { symbol: "5200.KL", name: "UOA Development", sector: "Property", refPrice: 2.0, cap: "M" },
  { symbol: "8664.KL", name: "SP Setia", sector: "Property", refPrice: 1.5, cap: "L" },
  { symbol: "8583.KL", name: "Mah Sing", sector: "Property", refPrice: 1.5, cap: "M", strategy: "vpb3" },
  { symbol: "5236.KL", name: "Matrix Concepts", sector: "Property", refPrice: 2.5, cap: "M" },
  { symbol: "7179.KL", name: "Lagenda Properties", sector: "Property", refPrice: 1.5, cap: "S" },
  { symbol: "5606.KL", name: "IGB Bhd", sector: "Property", refPrice: 2.0, cap: "M" },
  { symbol: "5148.KL", name: "UEM Sunrise", sector: "Property", refPrice: 0.8, cap: "M" },

  // ── Plantation ────────────────────────────────────────
  { symbol: "5183.KL", name: "Petronas Chemicals", sector: "Plantation", refPrice: 6.0, cap: "L" },
  { symbol: "5285.KL", name: "SD Guthrie", sector: "Plantation", refPrice: 4.5, cap: "L" },
  { symbol: "1961.KL", name: "IOI Corp", sector: "Plantation", refPrice: 4.0, cap: "L" },
  { symbol: "2445.KL", name: "KLK", sector: "Plantation", refPrice: 22.0, cap: "L" },
  { symbol: "2089.KL", name: "United Plantations", sector: "Plantation", refPrice: 28.0, cap: "L" },
  { symbol: "4731.KL", name: "Scientex", sector: "Plantation", refPrice: 4.0, cap: "L" },
  { symbol: "2291.KL", name: "Genting Plantations", sector: "Plantation", refPrice: 6.0, cap: "L" },
  { symbol: "1899.KL", name: "Batu Kawan", sector: "Plantation", refPrice: 20.0, cap: "L" },
  { symbol: "5126.KL", name: "Sarawak Oil Palms", sector: "Plantation", refPrice: 3.0, cap: "M" },
  { symbol: "5027.KL", name: "Kim Loong Resources", sector: "Plantation", refPrice: 2.0, cap: "S" },

  // ── Energy ────────────────────────────────────────────
  { symbol: "7277.KL", name: "Dialog Group", sector: "Energy", refPrice: 2.5, cap: "L" },
  { symbol: "5243.KL", name: "Velesto Energy", sector: "Energy", refPrice: 0.3, cap: "M" },
  { symbol: "5141.KL", name: "Dayang Enterprise", sector: "Energy", refPrice: 2.5, cap: "M" },
  { symbol: "5199.KL", name: "Hibiscus Petroleum", sector: "Energy", refPrice: 2.5, cap: "M" },
  { symbol: "7293.KL", name: "Yinson Holdings", sector: "Energy", refPrice: 3.0, cap: "L" },
  { symbol: "5210.KL", name: "Bumi Armada", sector: "Energy", refPrice: 0.8, cap: "M" },
  { symbol: "3042.KL", name: "Petron Malaysia", sector: "Energy", refPrice: 7.0, cap: "M" },
  { symbol: "4324.KL", name: "Hengyuan Refining", sector: "Energy", refPrice: 5.0, cap: "M" },
  { symbol: "5186.KL", name: "MMHE", sector: "Energy", refPrice: 0.5, cap: "M" },
  { symbol: "5133.KL", name: "Petra Energy", sector: "Energy", refPrice: 1.0, cap: "S" },

  // ── Utilities ─────────────────────────────────────────
  { symbol: "5347.KL", name: "Tenaga Nasional", sector: "Utilities", refPrice: 14.0, cap: "L" },
  { symbol: "6033.KL", name: "Petronas Gas", sector: "Utilities", refPrice: 18.0, cap: "L" },
  { symbol: "6742.KL", name: "YTL Power", sector: "Utilities", refPrice: 4.0, cap: "L" },
  { symbol: "4677.KL", name: "YTL Corp", sector: "Utilities", refPrice: 3.0, cap: "L" },
  { symbol: "5209.KL", name: "Gas Malaysia", sector: "Utilities", refPrice: 3.5, cap: "M" },
  { symbol: "3069.KL", name: "Mega First", sector: "Utilities", refPrice: 4.0, cap: "M" },
  { symbol: "5264.KL", name: "Malakoff", sector: "Utilities", refPrice: 1.0, cap: "M" },
  { symbol: "5272.KL", name: "Ranhill Utilities", sector: "Utilities", refPrice: 1.0, cap: "S" },
  { symbol: "8524.KL", name: "Taliworks", sector: "Utilities", refPrice: 0.9, cap: "S" },

  // ── Transportation ────────────────────────────────────
  { symbol: "3816.KL", name: "MISC", sector: "Transport", refPrice: 8.0, cap: "L" },
  { symbol: "5246.KL", name: "Westports", sector: "Transport", refPrice: 4.0, cap: "L" },
  { symbol: "5099.KL", name: "Capital A", sector: "Transport", refPrice: 1.0, cap: "M" },
  { symbol: "5032.KL", name: "Bintulu Port", sector: "Transport", refPrice: 6.0, cap: "M" },
  { symbol: "5983.KL", name: "MBM Resources", sector: "Transport", refPrice: 5.0, cap: "M" },
  { symbol: "0078.KL", name: "GDEX", sector: "Transport", refPrice: 0.2, cap: "S" },
  { symbol: "8397.KL", name: "Tiong Nam Logistics", sector: "Transport", refPrice: 1.5, cap: "S" },

  // ── REIT ──────────────────────────────────────────────
  { symbol: "5235SS.KL", name: "KLCC Property", sector: "REIT", refPrice: 8.0, cap: "L" },
  { symbol: "5227.KL", name: "IGB REIT", sector: "REIT", refPrice: 2.0, cap: "M" },
  { symbol: "5176.KL", name: "Sunway REIT", sector: "REIT", refPrice: 1.8, cap: "M" },
  { symbol: "5212.KL", name: "Pavilion REIT", sector: "REIT", refPrice: 1.5, cap: "M" },
  { symbol: "5106.KL", name: "Axis REIT", sector: "REIT", refPrice: 1.8, cap: "M" },
  { symbol: "5180.KL", name: "CapitaLand MY Trust", sector: "REIT", refPrice: 0.6, cap: "M" },
  { symbol: "5109.KL", name: "YTL REIT", sector: "REIT", refPrice: 1.2, cap: "M" },
];

// ── Derived helpers ─────────────────────────────────────
export const MY_SECTORS = Array.from(new Set(MY_STOCKS.map((s) => s.sector)));

export const MY_STOCKS_BY_SECTOR = MY_SECTORS.reduce<Record<string, MYStock[]>>(
  (acc, sector) => {
    acc[sector] = MY_STOCKS.filter((s) => s.sector === sector);
    return acc;
  },
  {},
);

/** Quick lookup: symbol → name */
export const MY_SYMBOL_MAP = Object.fromEntries(
  MY_STOCKS.map((s) => [s.symbol, s.name]),
);

/** Quick lookup: symbol → default strategy (if marked) */
export const MY_STOCK_STRATEGY = Object.fromEntries(
  MY_STOCKS.filter((s) => s.strategy).map((s) => [s.symbol, s.strategy!]),
);

/** Hot-pick 明星股 — default watchlist (10 stocks) */
export const MY_DEFAULT_SYMBOLS = [
  "5347.KL", "1155.KL", "1295.KL", "5398.KL", "0166.KL",
  "5225.KL", "8869.KL", "6947.KL", "5326.KL", "5211.KL",
] as const;

export const MY_DEFAULT_STOCKS = MY_DEFAULT_SYMBOLS
  .map((sym) => MY_STOCKS.find((s) => s.symbol === sym)!)
  .filter(Boolean);
