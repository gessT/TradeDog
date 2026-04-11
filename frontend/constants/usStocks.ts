// ═══════════════════════════════════════════════════════════════════════
// US Market Hot List — 200+ most traded / popular stocks by sector
// ═══════════════════════════════════════════════════════════════════════

export type USStock = {
  symbol: string;
  name: string;
  sector: string;
};

export const US_STOCKS: USStock[] = [
  // ── Mega Cap Tech ─────────────────────────────────────
  { symbol: "AAPL", name: "Apple", sector: "Tech" },
  { symbol: "MSFT", name: "Microsoft", sector: "Tech" },
  { symbol: "NVDA", name: "Nvidia", sector: "Tech" },
  { symbol: "GOOGL", name: "Alphabet", sector: "Tech" },
  { symbol: "AMZN", name: "Amazon", sector: "Tech" },
  { symbol: "META", name: "Meta Platforms", sector: "Tech" },
  { symbol: "TSLA", name: "Tesla", sector: "Tech" },
  { symbol: "AVGO", name: "Broadcom", sector: "Tech" },
  { symbol: "ORCL", name: "Oracle", sector: "Tech" },
  { symbol: "CRM", name: "Salesforce", sector: "Tech" },

  // ── Semiconductors ────────────────────────────────────
  { symbol: "AMD", name: "AMD", sector: "Semis" },
  { symbol: "INTC", name: "Intel", sector: "Semis" },
  { symbol: "QCOM", name: "Qualcomm", sector: "Semis" },
  { symbol: "MU", name: "Micron", sector: "Semis" },
  { symbol: "MRVL", name: "Marvell Tech", sector: "Semis" },
  { symbol: "ARM", name: "ARM Holdings", sector: "Semis" },
  { symbol: "AMAT", name: "Applied Materials", sector: "Semis" },
  { symbol: "LRCX", name: "Lam Research", sector: "Semis" },
  { symbol: "KLAC", name: "KLA Corp", sector: "Semis" },
  { symbol: "ADI", name: "Analog Devices", sector: "Semis" },
  { symbol: "TXN", name: "Texas Instruments", sector: "Semis" },
  { symbol: "ON", name: "ON Semiconductor", sector: "Semis" },
  { symbol: "SMCI", name: "Super Micro Computer", sector: "Semis" },
  { symbol: "TSM", name: "TSMC", sector: "Semis" },
  { symbol: "ASML", name: "ASML", sector: "Semis" },

  // ── Software & Cloud ──────────────────────────────────
  { symbol: "ADBE", name: "Adobe", sector: "Software" },
  { symbol: "NOW", name: "ServiceNow", sector: "Software" },
  { symbol: "SNPS", name: "Synopsys", sector: "Software" },
  { symbol: "CDNS", name: "Cadence Design", sector: "Software" },
  { symbol: "PANW", name: "Palo Alto Networks", sector: "Software" },
  { symbol: "CRWD", name: "CrowdStrike", sector: "Software" },
  { symbol: "FTNT", name: "Fortinet", sector: "Software" },
  { symbol: "ZS", name: "Zscaler", sector: "Software" },
  { symbol: "DDOG", name: "Datadog", sector: "Software" },
  { symbol: "NET", name: "Cloudflare", sector: "Software" },
  { symbol: "MDB", name: "MongoDB", sector: "Software" },
  { symbol: "SNOW", name: "Snowflake", sector: "Software" },
  { symbol: "PLTR", name: "Palantir", sector: "Software" },
  { symbol: "SHOP", name: "Shopify", sector: "Software" },
  { symbol: "SQ", name: "Block", sector: "Software" },
  { symbol: "UBER", name: "Uber", sector: "Software" },
  { symbol: "DASH", name: "DoorDash", sector: "Software" },
  { symbol: "TEAM", name: "Atlassian", sector: "Software" },
  { symbol: "WDAY", name: "Workday", sector: "Software" },
  { symbol: "TTD", name: "The Trade Desk", sector: "Software" },
  { symbol: "HUBS", name: "HubSpot", sector: "Software" },
  { symbol: "TWLO", name: "Twilio", sector: "Software" },
  { symbol: "APP", name: "AppLovin", sector: "Software" },

  // ── AI & Robotics ─────────────────────────────────────
  { symbol: "AI", name: "C3.ai", sector: "AI" },
  { symbol: "IONQ", name: "IonQ", sector: "AI" },
  { symbol: "BBAI", name: "BigBear.ai", sector: "AI" },
  { symbol: "PATH", name: "UiPath", sector: "AI" },
  { symbol: "UPST", name: "Upstart", sector: "AI" },
  { symbol: "SOUN", name: "SoundHound AI", sector: "AI" },

  // ── Internet & Social ─────────────────────────────────
  { symbol: "NFLX", name: "Netflix", sector: "Internet" },
  { symbol: "SPOT", name: "Spotify", sector: "Internet" },
  { symbol: "PINS", name: "Pinterest", sector: "Internet" },
  { symbol: "SNAP", name: "Snap", sector: "Internet" },
  { symbol: "RBLX", name: "Roblox", sector: "Internet" },
  { symbol: "U", name: "Unity Software", sector: "Internet" },
  { symbol: "ROKU", name: "Roku", sector: "Internet" },
  { symbol: "BIDU", name: "Baidu", sector: "Internet" },
  { symbol: "PDD", name: "PDD Holdings", sector: "Internet" },
  { symbol: "JD", name: "JD.com", sector: "Internet" },
  { symbol: "BABA", name: "Alibaba", sector: "Internet" },
  { symbol: "SE", name: "Sea Limited", sector: "Internet" },
  { symbol: "GRAB", name: "Grab Holdings", sector: "Internet" },

  // ── Fintech & Finance ─────────────────────────────────
  { symbol: "V", name: "Visa", sector: "Finance" },
  { symbol: "MA", name: "Mastercard", sector: "Finance" },
  { symbol: "PYPL", name: "PayPal", sector: "Finance" },
  { symbol: "COIN", name: "Coinbase", sector: "Finance" },
  { symbol: "SOFI", name: "SoFi Technologies", sector: "Finance" },
  { symbol: "HOOD", name: "Robinhood", sector: "Finance" },
  { symbol: "AFRM", name: "Affirm", sector: "Finance" },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Finance" },
  { symbol: "BAC", name: "Bank of America", sector: "Finance" },
  { symbol: "GS", name: "Goldman Sachs", sector: "Finance" },
  { symbol: "MS", name: "Morgan Stanley", sector: "Finance" },
  { symbol: "WFC", name: "Wells Fargo", sector: "Finance" },
  { symbol: "C", name: "Citigroup", sector: "Finance" },
  { symbol: "SCHW", name: "Charles Schwab", sector: "Finance" },
  { symbol: "BLK", name: "BlackRock", sector: "Finance" },
  { symbol: "AXP", name: "American Express", sector: "Finance" },
  { symbol: "ICE", name: "Intercontinental Exchange", sector: "Finance" },

  // ── Healthcare & Biotech ──────────────────────────────
  { symbol: "UNH", name: "UnitedHealth", sector: "Health" },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Health" },
  { symbol: "LLY", name: "Eli Lilly", sector: "Health" },
  { symbol: "NVO", name: "Novo Nordisk", sector: "Health" },
  { symbol: "ABBV", name: "AbbVie", sector: "Health" },
  { symbol: "MRK", name: "Merck", sector: "Health" },
  { symbol: "PFE", name: "Pfizer", sector: "Health" },
  { symbol: "TMO", name: "Thermo Fisher", sector: "Health" },
  { symbol: "ABT", name: "Abbott Labs", sector: "Health" },
  { symbol: "AMGN", name: "Amgen", sector: "Health" },
  { symbol: "GILD", name: "Gilead Sciences", sector: "Health" },
  { symbol: "ISRG", name: "Intuitive Surgical", sector: "Health" },
  { symbol: "VRTX", name: "Vertex Pharma", sector: "Health" },
  { symbol: "MRNA", name: "Moderna", sector: "Health" },
  { symbol: "REGN", name: "Regeneron", sector: "Health" },
  { symbol: "BMY", name: "Bristol-Myers", sector: "Health" },
  { symbol: "DHR", name: "Danaher", sector: "Health" },
  { symbol: "DXCM", name: "DexCom", sector: "Health" },

  // ── Consumer & Retail ─────────────────────────────────
  { symbol: "WMT", name: "Walmart", sector: "Consumer" },
  { symbol: "COST", name: "Costco", sector: "Consumer" },
  { symbol: "HD", name: "Home Depot", sector: "Consumer" },
  { symbol: "TGT", name: "Target", sector: "Consumer" },
  { symbol: "LOW", name: "Lowe's", sector: "Consumer" },
  { symbol: "NKE", name: "Nike", sector: "Consumer" },
  { symbol: "SBUX", name: "Starbucks", sector: "Consumer" },
  { symbol: "MCD", name: "McDonald's", sector: "Consumer" },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer" },
  { symbol: "KO", name: "Coca-Cola", sector: "Consumer" },
  { symbol: "PEP", name: "PepsiCo", sector: "Consumer" },
  { symbol: "DIS", name: "Disney", sector: "Consumer" },
  { symbol: "LULU", name: "Lululemon", sector: "Consumer" },
  { symbol: "CMG", name: "Chipotle", sector: "Consumer" },
  { symbol: "ABNB", name: "Airbnb", sector: "Consumer" },
  { symbol: "BKNG", name: "Booking Holdings", sector: "Consumer" },

  // ── EV & Auto ─────────────────────────────────────────
  { symbol: "RIVN", name: "Rivian", sector: "EV" },
  { symbol: "LCID", name: "Lucid Group", sector: "EV" },
  { symbol: "NIO", name: "NIO", sector: "EV" },
  { symbol: "XPEV", name: "XPeng", sector: "EV" },
  { symbol: "LI", name: "Li Auto", sector: "EV" },
  { symbol: "F", name: "Ford", sector: "EV" },
  { symbol: "GM", name: "General Motors", sector: "EV" },
  { symbol: "TM", name: "Toyota", sector: "EV" },

  // ── Energy & Oil ──────────────────────────────────────
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy" },
  { symbol: "CVX", name: "Chevron", sector: "Energy" },
  { symbol: "COP", name: "ConocoPhillips", sector: "Energy" },
  { symbol: "SLB", name: "Schlumberger", sector: "Energy" },
  { symbol: "EOG", name: "EOG Resources", sector: "Energy" },
  { symbol: "OXY", name: "Occidental Petroleum", sector: "Energy" },
  { symbol: "MPC", name: "Marathon Petroleum", sector: "Energy" },
  { symbol: "VLO", name: "Valero Energy", sector: "Energy" },
  { symbol: "PSX", name: "Phillips 66", sector: "Energy" },
  { symbol: "HAL", name: "Halliburton", sector: "Energy" },

  // ── Clean Energy & Solar ──────────────────────────────
  { symbol: "ENPH", name: "Enphase Energy", sector: "Clean Energy" },
  { symbol: "FSLR", name: "First Solar", sector: "Clean Energy" },
  { symbol: "SEDG", name: "SolarEdge", sector: "Clean Energy" },
  { symbol: "NEE", name: "NextEra Energy", sector: "Clean Energy" },
  { symbol: "PLUG", name: "Plug Power", sector: "Clean Energy" },
  { symbol: "BE", name: "Bloom Energy", sector: "Clean Energy" },

  // ── Industrials & Aerospace ───────────────────────────
  { symbol: "BA", name: "Boeing", sector: "Industrial" },
  { symbol: "CAT", name: "Caterpillar", sector: "Industrial" },
  { symbol: "HON", name: "Honeywell", sector: "Industrial" },
  { symbol: "LMT", name: "Lockheed Martin", sector: "Industrial" },
  { symbol: "RTX", name: "RTX Corp", sector: "Industrial" },
  { symbol: "GE", name: "GE Aerospace", sector: "Industrial" },
  { symbol: "DE", name: "Deere & Co", sector: "Industrial" },
  { symbol: "UPS", name: "UPS", sector: "Industrial" },
  { symbol: "FDX", name: "FedEx", sector: "Industrial" },
  { symbol: "UNP", name: "Union Pacific", sector: "Industrial" },

  // ── Telecom & Media ───────────────────────────────────
  { symbol: "T", name: "AT&T", sector: "Telecom" },
  { symbol: "VZ", name: "Verizon", sector: "Telecom" },
  { symbol: "TMUS", name: "T-Mobile", sector: "Telecom" },
  { symbol: "CMCSA", name: "Comcast", sector: "Telecom" },
  { symbol: "WBD", name: "Warner Bros Discovery", sector: "Telecom" },
  { symbol: "PARA", name: "Paramount Global", sector: "Telecom" },

  // ── REITs & Real Estate ───────────────────────────────
  { symbol: "AMT", name: "American Tower", sector: "REIT" },
  { symbol: "PLD", name: "Prologis", sector: "REIT" },
  { symbol: "CCI", name: "Crown Castle", sector: "REIT" },
  { symbol: "EQIX", name: "Equinix", sector: "REIT" },
  { symbol: "SPG", name: "Simon Property", sector: "REIT" },
  { symbol: "O", name: "Realty Income", sector: "REIT" },

  // ── Crypto & Blockchain ───────────────────────────────
  { symbol: "MSTR", name: "MicroStrategy", sector: "Crypto" },
  { symbol: "MARA", name: "Marathon Digital", sector: "Crypto" },
  { symbol: "RIOT", name: "Riot Platforms", sector: "Crypto" },
  { symbol: "CLSK", name: "CleanSpark", sector: "Crypto" },
  { symbol: "HUT", name: "Hut 8 Mining", sector: "Crypto" },
  { symbol: "BITF", name: "Bitfarms", sector: "Crypto" },

  // ── Cannabis ──────────────────────────────────────────
  { symbol: "TLRY", name: "Tilray Brands", sector: "Cannabis" },
  { symbol: "CGC", name: "Canopy Growth", sector: "Cannabis" },

  // ── Materials & Mining ────────────────────────────────
  { symbol: "FCX", name: "Freeport-McMoRan", sector: "Materials" },
  { symbol: "NEM", name: "Newmont", sector: "Materials" },
  { symbol: "NUE", name: "Nucor", sector: "Materials" },
  { symbol: "CLF", name: "Cleveland-Cliffs", sector: "Materials" },
  { symbol: "AA", name: "Alcoa", sector: "Materials" },
  { symbol: "X", name: "United States Steel", sector: "Materials" },

  // ── Popular Meme / High-Vol ───────────────────────────
  { symbol: "GME", name: "GameStop", sector: "Meme" },
  { symbol: "AMC", name: "AMC Entertainment", sector: "Meme" },
  { symbol: "BBBY", name: "Bed Bath & Beyond", sector: "Meme" },
  { symbol: "SPCE", name: "Virgin Galactic", sector: "Meme" },
  { symbol: "CLOV", name: "Clover Health", sector: "Meme" },
  { symbol: "OPEN", name: "Opendoor", sector: "Meme" },
  { symbol: "WISH", name: "ContextLogic", sector: "Meme" },

  // ── SPACs / Growth ────────────────────────────────────
  { symbol: "DKNG", name: "DraftKings", sector: "Growth" },
  { symbol: "CRSP", name: "CRISPR Therapeutics", sector: "Growth" },
  { symbol: "CELH", name: "Celsius Holdings", sector: "Growth" },
  { symbol: "DUOL", name: "Duolingo", sector: "Growth" },
  { symbol: "TOST", name: "Toast", sector: "Growth" },
  { symbol: "CAVA", name: "CAVA Group", sector: "Growth" },
  { symbol: "BIRK", name: "Birkenstock", sector: "Growth" },

  // ── Cybersecurity ─────────────────────────────────────
  { symbol: "S", name: "SentinelOne", sector: "Cyber" },
  { symbol: "OKTA", name: "Okta", sector: "Cyber" },
  { symbol: "CYBR", name: "CyberArk", sector: "Cyber" },

  // ── ETFs (Popular) ────────────────────────────────────
  { symbol: "SPY", name: "S&P 500 ETF", sector: "ETF" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", sector: "ETF" },
  { symbol: "IWM", name: "Russell 2000 ETF", sector: "ETF" },
  { symbol: "DIA", name: "Dow Jones ETF", sector: "ETF" },
  { symbol: "ARKK", name: "ARK Innovation ETF", sector: "ETF" },
  { symbol: "XLF", name: "Financial Select ETF", sector: "ETF" },
  { symbol: "XLE", name: "Energy Select ETF", sector: "ETF" },
  { symbol: "XLK", name: "Tech Select ETF", sector: "ETF" },
  { symbol: "SOXX", name: "Semiconductor ETF", sector: "ETF" },
  { symbol: "GLD", name: "Gold ETF", sector: "ETF" },
  { symbol: "SLV", name: "Silver ETF", sector: "ETF" },
  { symbol: "TLT", name: "20+ Year Treasury ETF", sector: "ETF" },
  { symbol: "VIX", name: "Volatility Index", sector: "ETF" },
  { symbol: "SOXL", name: "3x Semis Bull ETF", sector: "ETF" },
  { symbol: "TQQQ", name: "3x Nasdaq Bull ETF", sector: "ETF" },
];

// ── Derived helpers ─────────────────────────────────────
export const US_SECTORS = [...new Set(US_STOCKS.map((s) => s.sector))];

export const US_STOCKS_BY_SECTOR = US_SECTORS.reduce<Record<string, USStock[]>>(
  (acc, sector) => {
    acc[sector] = US_STOCKS.filter((s) => s.sector === sector);
    return acc;
  },
  {},
);

/** Quick lookup: symbol → name */
export const US_SYMBOL_MAP = Object.fromEntries(
  US_STOCKS.map((s) => [s.symbol, s.name]),
);
