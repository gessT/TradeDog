// ======================================================================
// SGX Stock List - major Singapore Exchange stocks by sector
// Yahoo Finance symbols (.SI suffix)
// ======================================================================

export type SGXStock = {
  symbol: string;
  name: string;
  sector: string;
  /** Approximate reference price (SGD) */
  refPrice: number;
  /** Market cap tier: L=Large, M=Mid, S=Small */
  cap: "L" | "M" | "S";
};

export const SGX_STOCKS: SGXStock[] = [
  // Finance
  { symbol: "D05.SI", name: "DBS Group", sector: "Finance", refPrice: 34.0, cap: "L" },
  { symbol: "O39.SI", name: "OCBC Bank", sector: "Finance", refPrice: 14.5, cap: "L" },
  { symbol: "U11.SI", name: "UOB", sector: "Finance", refPrice: 30.0, cap: "L" },
  { symbol: "S68.SI", name: "Singapore Exchange", sector: "Finance", refPrice: 10.0, cap: "L" },
  { symbol: "Q0F.SI", name: "iFAST", sector: "Finance", refPrice: 7.0, cap: "M" },

  // Telecom / Infra
  { symbol: "Z74.SI", name: "Singtel", sector: "Telecom", refPrice: 2.9, cap: "L" },
  { symbol: "CC3.SI", name: "StarHub", sector: "Telecom", refPrice: 1.1, cap: "M" },

  // Transport
  { symbol: "C6L.SI", name: "Singapore Airlines", sector: "Transport", refPrice: 6.8, cap: "L" },
  { symbol: "S58.SI", name: "SATS", sector: "Transport", refPrice: 3.0, cap: "M" },
  { symbol: "C52.SI", name: "ComfortDelGro", sector: "Transport", refPrice: 1.4, cap: "M" },

  // Property
  { symbol: "C31.SI", name: "CapitaLand Investment", sector: "Property", refPrice: 3.1, cap: "L" },
  { symbol: "C09.SI", name: "City Developments", sector: "Property", refPrice: 5.2, cap: "M" },
  { symbol: "U14.SI", name: "UOL Group", sector: "Property", refPrice: 6.0, cap: "M" },
  { symbol: "H78.SI", name: "Hongkong Land", sector: "Property", refPrice: 3.5, cap: "M" },

  // REIT
  { symbol: "C38U.SI", name: "CapitaLand Integrated Com Trust", sector: "REIT", refPrice: 1.8, cap: "L" },
  { symbol: "A17U.SI", name: "CapitaLand Ascendas REIT", sector: "REIT", refPrice: 2.7, cap: "L" },
  { symbol: "N2IU.SI", name: "Mapletree Pan Asia Com Trust", sector: "REIT", refPrice: 1.2, cap: "M" },
  { symbol: "M44U.SI", name: "Mapletree Logistics Trust", sector: "REIT", refPrice: 1.4, cap: "L" },
  { symbol: "ME8U.SI", name: "Mapletree Industrial Trust", sector: "REIT", refPrice: 2.4, cap: "M" },
  { symbol: "BUOU.SI", name: "Frasers Logistics & Com Trust", sector: "REIT", refPrice: 1.1, cap: "M" },
  { symbol: "T39.SI", name: "Frasers Centrepoint Trust", sector: "REIT", refPrice: 2.1, cap: "M" },
  { symbol: "HMN.SI", name: "CapitaLand Ascott Trust", sector: "REIT", refPrice: 0.95, cap: "M" },

  // Industrial / Energy
  { symbol: "BN4.SI", name: "Keppel", sector: "Industrial", refPrice: 6.8, cap: "L" },
  { symbol: "S51.SI", name: "Seatrium", sector: "Industrial", refPrice: 1.6, cap: "M" },
  { symbol: "BS6.SI", name: "Yangzijiang Shipbuilding", sector: "Industrial", refPrice: 2.4, cap: "M" },
  { symbol: "U96.SI", name: "Sembcorp Industries", sector: "Utilities", refPrice: 5.3, cap: "L" },

  // Consumer / Tech
  { symbol: "G13.SI", name: "Genting Singapore", sector: "Consumer", refPrice: 1.0, cap: "L" },
  { symbol: "Y92.SI", name: "Thai Beverage", sector: "Consumer", refPrice: 0.55, cap: "L" },
  { symbol: "F34.SI", name: "Wilmar International", sector: "Consumer", refPrice: 3.2, cap: "L" },
  { symbol: "V03.SI", name: "Venture Corporation", sector: "Tech", refPrice: 14.0, cap: "M" },

  // ETF
  { symbol: "ES3.SI", name: "Nikko AM STI ETF", sector: "ETF", refPrice: 3.4, cap: "L" },
  { symbol: "A35.SI", name: "ABF Singapore Bond Index ETF", sector: "ETF", refPrice: 1.05, cap: "L" },
];

export const SGX_SECTORS = Array.from(new Set(SGX_STOCKS.map((s) => s.sector)));

export const SGX_STOCKS_BY_SECTOR = SGX_SECTORS.reduce<Record<string, SGXStock[]>>(
  (acc, sector) => {
    acc[sector] = SGX_STOCKS.filter((s) => s.sector === sector);
    return acc;
  },
  {},
);

/** Quick lookup: symbol -> name */
export const SGX_SYMBOL_MAP = Object.fromEntries(
  SGX_STOCKS.map((s) => [s.symbol, s.name]),
);

/** SGX default watchlist */
export const SGX_DEFAULT_SYMBOLS = [
  "D05.SI", "O39.SI", "U11.SI", "C6L.SI", "S68.SI",
  "C31.SI", "A17U.SI", "BN4.SI", "U96.SI", "ES3.SI",
] as const;

export const SGX_DEFAULT_STOCKS = SGX_DEFAULT_SYMBOLS
  .map((sym) => SGX_STOCKS.find((s) => s.symbol === sym)!)
  .filter(Boolean);
