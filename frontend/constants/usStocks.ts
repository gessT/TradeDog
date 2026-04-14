// ═══════════════════════════════════════════════════════════════════════
// US Market Hot List — 200+ most traded / popular stocks by sector
// ═══════════════════════════════════════════════════════════════════════

export type USStock = {
  symbol: string;
  name: string;
  sector: string;
  /** Approximate reference price (USD) — used as fallback when live feed unavailable */
  refPrice: number;
  /** Market cap tier: L=Large, M=Mid, S=Small */
  cap: "L" | "M" | "S";
};

export const US_STOCKS: USStock[] = [
  // ── Mega Cap Tech ─────────────────────────────────────
  { symbol: "AAPL", name: "Apple", sector: "Tech", refPrice: 195.0, cap: "L" },
  { symbol: "MSFT", name: "Microsoft", sector: "Tech", refPrice: 420.0, cap: "L" },
  { symbol: "NVDA", name: "Nvidia", sector: "Tech", refPrice: 130.0, cap: "L" },
  { symbol: "GOOGL", name: "Alphabet", sector: "Tech", refPrice: 175.0, cap: "L" },
  { symbol: "AMZN", name: "Amazon", sector: "Tech", refPrice: 185.0, cap: "L" },
  { symbol: "META", name: "Meta Platforms", sector: "Tech", refPrice: 500.0, cap: "L" },
  { symbol: "TSLA", name: "Tesla", sector: "Tech", refPrice: 250.0, cap: "L" },
  { symbol: "AVGO", name: "Broadcom", sector: "Tech", refPrice: 170.0, cap: "L" },
  { symbol: "ORCL", name: "Oracle", sector: "Tech", refPrice: 160.0, cap: "L" },
  { symbol: "CRM", name: "Salesforce", sector: "Tech", refPrice: 275.0, cap: "L" },

  // ── Semiconductors ────────────────────────────────────
  { symbol: "AMD", name: "AMD", sector: "Semis", refPrice: 160.0, cap: "L" },
  { symbol: "INTC", name: "Intel", sector: "Semis", refPrice: 22.0, cap: "L" },
  { symbol: "QCOM", name: "Qualcomm", sector: "Semis", refPrice: 170.0, cap: "L" },
  { symbol: "MU", name: "Micron", sector: "Semis", refPrice: 105.0, cap: "L" },
  { symbol: "MRVL", name: "Marvell Tech", sector: "Semis", refPrice: 75.0, cap: "L" },
  { symbol: "ARM", name: "ARM Holdings", sector: "Semis", refPrice: 160.0, cap: "L" },
  { symbol: "AMAT", name: "Applied Materials", sector: "Semis", refPrice: 200.0, cap: "L" },
  { symbol: "LRCX", name: "Lam Research", sector: "Semis", refPrice: 95.0, cap: "L" },
  { symbol: "KLAC", name: "KLA Corp", sector: "Semis", refPrice: 700.0, cap: "L" },
  { symbol: "ADI", name: "Analog Devices", sector: "Semis", refPrice: 210.0, cap: "L" },
  { symbol: "TXN", name: "Texas Instruments", sector: "Semis", refPrice: 175.0, cap: "L" },
  { symbol: "ON", name: "ON Semiconductor", sector: "Semis", refPrice: 55.0, cap: "M" },
  { symbol: "SMCI", name: "Super Micro Computer", sector: "Semis", refPrice: 40.0, cap: "M" },
  { symbol: "TSM", name: "TSMC", sector: "Semis", refPrice: 175.0, cap: "L" },
  { symbol: "ASML", name: "ASML", sector: "Semis", refPrice: 730.0, cap: "L" },

  // ── Software & Cloud ──────────────────────────────────
  { symbol: "ADBE", name: "Adobe", sector: "Software", refPrice: 480.0, cap: "L" },
  { symbol: "NOW", name: "ServiceNow", sector: "Software", refPrice: 850.0, cap: "L" },
  { symbol: "SNPS", name: "Synopsys", sector: "Software", refPrice: 530.0, cap: "L" },
  { symbol: "CDNS", name: "Cadence Design", sector: "Software", refPrice: 290.0, cap: "L" },
  { symbol: "PANW", name: "Palo Alto Networks", sector: "Software", refPrice: 330.0, cap: "L" },
  { symbol: "CRWD", name: "CrowdStrike", sector: "Software", refPrice: 370.0, cap: "L" },
  { symbol: "FTNT", name: "Fortinet", sector: "Software", refPrice: 100.0, cap: "L" },
  { symbol: "ZS", name: "Zscaler", sector: "Software", refPrice: 220.0, cap: "M" },
  { symbol: "DDOG", name: "Datadog", sector: "Software", refPrice: 130.0, cap: "M" },
  { symbol: "NET", name: "Cloudflare", sector: "Software", refPrice: 100.0, cap: "M" },
  { symbol: "MDB", name: "MongoDB", sector: "Software", refPrice: 260.0, cap: "M" },
  { symbol: "SNOW", name: "Snowflake", sector: "Software", refPrice: 170.0, cap: "L" },
  { symbol: "PLTR", name: "Palantir", sector: "Software", refPrice: 65.0, cap: "L" },
  { symbol: "SHOP", name: "Shopify", sector: "Software", refPrice: 80.0, cap: "L" },
  { symbol: "SQ", name: "Block", sector: "Software", refPrice: 75.0, cap: "M" },
  { symbol: "UBER", name: "Uber", sector: "Software", refPrice: 75.0, cap: "L" },
  { symbol: "DASH", name: "DoorDash", sector: "Software", refPrice: 165.0, cap: "M" },
  { symbol: "TEAM", name: "Atlassian", sector: "Software", refPrice: 240.0, cap: "M" },
  { symbol: "WDAY", name: "Workday", sector: "Software", refPrice: 260.0, cap: "L" },
  { symbol: "TTD", name: "The Trade Desk", sector: "Software", refPrice: 95.0, cap: "M" },
  { symbol: "HUBS", name: "HubSpot", sector: "Software", refPrice: 600.0, cap: "M" },
  { symbol: "TWLO", name: "Twilio", sector: "Software", refPrice: 70.0, cap: "M" },
  { symbol: "APP", name: "AppLovin", sector: "Software", refPrice: 330.0, cap: "M" },

  // ── AI & Robotics ─────────────────────────────────────
  { symbol: "AI", name: "C3.ai", sector: "AI", refPrice: 30.0, cap: "S" },
  { symbol: "IONQ", name: "IonQ", sector: "AI", refPrice: 35.0, cap: "S" },
  { symbol: "BBAI", name: "BigBear.ai", sector: "AI", refPrice: 5.0, cap: "S" },
  { symbol: "PATH", name: "UiPath", sector: "AI", refPrice: 15.0, cap: "M" },
  { symbol: "UPST", name: "Upstart", sector: "AI", refPrice: 60.0, cap: "S" },
  { symbol: "SOUN", name: "SoundHound AI", sector: "AI", refPrice: 12.0, cap: "S" },

  // ── Internet & Social ─────────────────────────────────
  { symbol: "NFLX", name: "Netflix", sector: "Internet", refPrice: 800.0, cap: "L" },
  { symbol: "SPOT", name: "Spotify", sector: "Internet", refPrice: 580.0, cap: "L" },
  { symbol: "PINS", name: "Pinterest", sector: "Internet", refPrice: 38.0, cap: "M" },
  { symbol: "SNAP", name: "Snap", sector: "Internet", refPrice: 12.0, cap: "M" },
  { symbol: "RBLX", name: "Roblox", sector: "Internet", refPrice: 55.0, cap: "M" },
  { symbol: "U", name: "Unity Software", sector: "Internet", refPrice: 25.0, cap: "M" },
  { symbol: "ROKU", name: "Roku", sector: "Internet", refPrice: 70.0, cap: "M" },
  { symbol: "BIDU", name: "Baidu", sector: "Internet", refPrice: 90.0, cap: "L" },
  { symbol: "PDD", name: "PDD Holdings", sector: "Internet", refPrice: 130.0, cap: "L" },
  { symbol: "JD", name: "JD.com", sector: "Internet", refPrice: 35.0, cap: "L" },
  { symbol: "BABA", name: "Alibaba", sector: "Internet", refPrice: 85.0, cap: "L" },
  { symbol: "SE", name: "Sea Limited", sector: "Internet", refPrice: 100.0, cap: "M" },
  { symbol: "GRAB", name: "Grab Holdings", sector: "Internet", refPrice: 5.0, cap: "S" },

  // ── Fintech & Finance ─────────────────────────────────
  { symbol: "V", name: "Visa", sector: "Finance", refPrice: 285.0, cap: "L" },
  { symbol: "MA", name: "Mastercard", sector: "Finance", refPrice: 470.0, cap: "L" },
  { symbol: "PYPL", name: "PayPal", sector: "Finance", refPrice: 70.0, cap: "L" },
  { symbol: "COIN", name: "Coinbase", sector: "Finance", refPrice: 260.0, cap: "M" },
  { symbol: "SOFI", name: "SoFi Technologies", sector: "Finance", refPrice: 14.0, cap: "M" },
  { symbol: "HOOD", name: "Robinhood", sector: "Finance", refPrice: 45.0, cap: "M" },
  { symbol: "AFRM", name: "Affirm", sector: "Finance", refPrice: 55.0, cap: "M" },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Finance", refPrice: 210.0, cap: "L" },
  { symbol: "BAC", name: "Bank of America", sector: "Finance", refPrice: 38.0, cap: "L" },
  { symbol: "GS", name: "Goldman Sachs", sector: "Finance", refPrice: 470.0, cap: "L" },
  { symbol: "MS", name: "Morgan Stanley", sector: "Finance", refPrice: 100.0, cap: "L" },
  { symbol: "WFC", name: "Wells Fargo", sector: "Finance", refPrice: 55.0, cap: "L" },
  { symbol: "C", name: "Citigroup", sector: "Finance", refPrice: 60.0, cap: "L" },
  { symbol: "SCHW", name: "Charles Schwab", sector: "Finance", refPrice: 75.0, cap: "L" },
  { symbol: "BLK", name: "BlackRock", sector: "Finance", refPrice: 850.0, cap: "L" },
  { symbol: "AXP", name: "American Express", sector: "Finance", refPrice: 240.0, cap: "L" },
  { symbol: "ICE", name: "Intercontinental Exchange", sector: "Finance", refPrice: 145.0, cap: "L" },

  // ── Healthcare & Biotech ──────────────────────────────
  { symbol: "UNH", name: "UnitedHealth", sector: "Health", refPrice: 520.0, cap: "L" },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Health", refPrice: 155.0, cap: "L" },
  { symbol: "LLY", name: "Eli Lilly", sector: "Health", refPrice: 800.0, cap: "L" },
  { symbol: "NVO", name: "Novo Nordisk", sector: "Health", refPrice: 130.0, cap: "L" },
  { symbol: "ABBV", name: "AbbVie", sector: "Health", refPrice: 185.0, cap: "L" },
  { symbol: "MRK", name: "Merck", sector: "Health", refPrice: 120.0, cap: "L" },
  { symbol: "PFE", name: "Pfizer", sector: "Health", refPrice: 28.0, cap: "L" },
  { symbol: "TMO", name: "Thermo Fisher", sector: "Health", refPrice: 570.0, cap: "L" },
  { symbol: "ABT", name: "Abbott Labs", sector: "Health", refPrice: 115.0, cap: "L" },
  { symbol: "AMGN", name: "Amgen", sector: "Health", refPrice: 310.0, cap: "L" },
  { symbol: "GILD", name: "Gilead Sciences", sector: "Health", refPrice: 90.0, cap: "L" },
  { symbol: "ISRG", name: "Intuitive Surgical", sector: "Health", refPrice: 470.0, cap: "L" },
  { symbol: "VRTX", name: "Vertex Pharma", sector: "Health", refPrice: 430.0, cap: "L" },
  { symbol: "MRNA", name: "Moderna", sector: "Health", refPrice: 95.0, cap: "L" },
  { symbol: "REGN", name: "Regeneron", sector: "Health", refPrice: 960.0, cap: "L" },
  { symbol: "BMY", name: "Bristol-Myers", sector: "Health", refPrice: 50.0, cap: "L" },
  { symbol: "DHR", name: "Danaher", sector: "Health", refPrice: 250.0, cap: "L" },
  { symbol: "DXCM", name: "DexCom", sector: "Health", refPrice: 80.0, cap: "M" },

  // ── Consumer & Retail ─────────────────────────────────
  { symbol: "WMT", name: "Walmart", sector: "Consumer", refPrice: 170.0, cap: "L" },
  { symbol: "COST", name: "Costco", sector: "Consumer", refPrice: 750.0, cap: "L" },
  { symbol: "HD", name: "Home Depot", sector: "Consumer", refPrice: 370.0, cap: "L" },
  { symbol: "TGT", name: "Target", sector: "Consumer", refPrice: 140.0, cap: "L" },
  { symbol: "LOW", name: "Lowe's", sector: "Consumer", refPrice: 240.0, cap: "L" },
  { symbol: "NKE", name: "Nike", sector: "Consumer", refPrice: 95.0, cap: "L" },
  { symbol: "SBUX", name: "Starbucks", sector: "Consumer", refPrice: 100.0, cap: "L" },
  { symbol: "MCD", name: "McDonald's", sector: "Consumer", refPrice: 290.0, cap: "L" },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer", refPrice: 170.0, cap: "L" },
  { symbol: "KO", name: "Coca-Cola", sector: "Consumer", refPrice: 62.0, cap: "L" },
  { symbol: "PEP", name: "PepsiCo", sector: "Consumer", refPrice: 170.0, cap: "L" },
  { symbol: "DIS", name: "Disney", sector: "Consumer", refPrice: 110.0, cap: "L" },
  { symbol: "LULU", name: "Lululemon", sector: "Consumer", refPrice: 400.0, cap: "L" },
  { symbol: "CMG", name: "Chipotle", sector: "Consumer", refPrice: 60.0, cap: "L" },
  { symbol: "ABNB", name: "Airbnb", sector: "Consumer", refPrice: 155.0, cap: "L" },
  { symbol: "BKNG", name: "Booking Holdings", sector: "Consumer", refPrice: 3800.0, cap: "L" },

  // ── EV & Auto ─────────────────────────────────────────
  { symbol: "RIVN", name: "Rivian", sector: "EV", refPrice: 15.0, cap: "M" },
  { symbol: "LCID", name: "Lucid Group", sector: "EV", refPrice: 3.5, cap: "S" },
  { symbol: "NIO", name: "NIO", sector: "EV", refPrice: 5.0, cap: "M" },
  { symbol: "XPEV", name: "XPeng", sector: "EV", refPrice: 15.0, cap: "M" },
  { symbol: "LI", name: "Li Auto", sector: "EV", refPrice: 30.0, cap: "M" },
  { symbol: "F", name: "Ford", sector: "EV", refPrice: 11.0, cap: "L" },
  { symbol: "GM", name: "General Motors", sector: "EV", refPrice: 45.0, cap: "L" },
  { symbol: "TM", name: "Toyota", sector: "EV", refPrice: 190.0, cap: "L" },

  // ── Energy & Oil ──────────────────────────────────────
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy", refPrice: 110.0, cap: "L" },
  { symbol: "CVX", name: "Chevron", sector: "Energy", refPrice: 155.0, cap: "L" },
  { symbol: "COP", name: "ConocoPhillips", sector: "Energy", refPrice: 115.0, cap: "L" },
  { symbol: "SLB", name: "Schlumberger", sector: "Energy", refPrice: 45.0, cap: "L" },
  { symbol: "EOG", name: "EOG Resources", sector: "Energy", refPrice: 125.0, cap: "L" },
  { symbol: "OXY", name: "Occidental Petroleum", sector: "Energy", refPrice: 55.0, cap: "L" },
  { symbol: "MPC", name: "Marathon Petroleum", sector: "Energy", refPrice: 170.0, cap: "L" },
  { symbol: "VLO", name: "Valero Energy", sector: "Energy", refPrice: 140.0, cap: "L" },
  { symbol: "PSX", name: "Phillips 66", sector: "Energy", refPrice: 140.0, cap: "L" },
  { symbol: "HAL", name: "Halliburton", sector: "Energy", refPrice: 32.0, cap: "L" },

  // ── Clean Energy & Solar ──────────────────────────────
  { symbol: "ENPH", name: "Enphase Energy", sector: "Clean Energy", refPrice: 115.0, cap: "M" },
  { symbol: "FSLR", name: "First Solar", sector: "Clean Energy", refPrice: 195.0, cap: "M" },
  { symbol: "SEDG", name: "SolarEdge", sector: "Clean Energy", refPrice: 20.0, cap: "S" },
  { symbol: "NEE", name: "NextEra Energy", sector: "Clean Energy", refPrice: 75.0, cap: "L" },
  { symbol: "PLUG", name: "Plug Power", sector: "Clean Energy", refPrice: 3.0, cap: "S" },
  { symbol: "BE", name: "Bloom Energy", sector: "Clean Energy", refPrice: 18.0, cap: "S" },

  // ── Industrials & Aerospace ───────────────────────────
  { symbol: "BA", name: "Boeing", sector: "Industrial", refPrice: 185.0, cap: "L" },
  { symbol: "CAT", name: "Caterpillar", sector: "Industrial", refPrice: 350.0, cap: "L" },
  { symbol: "HON", name: "Honeywell", sector: "Industrial", refPrice: 210.0, cap: "L" },
  { symbol: "LMT", name: "Lockheed Martin", sector: "Industrial", refPrice: 450.0, cap: "L" },
  { symbol: "RTX", name: "RTX Corp", sector: "Industrial", refPrice: 105.0, cap: "L" },
  { symbol: "GE", name: "GE Aerospace", sector: "Industrial", refPrice: 175.0, cap: "L" },
  { symbol: "DE", name: "Deere & Co", sector: "Industrial", refPrice: 400.0, cap: "L" },
  { symbol: "UPS", name: "UPS", sector: "Industrial", refPrice: 140.0, cap: "L" },
  { symbol: "FDX", name: "FedEx", sector: "Industrial", refPrice: 270.0, cap: "L" },
  { symbol: "UNP", name: "Union Pacific", sector: "Industrial", refPrice: 240.0, cap: "L" },

  // ── Telecom & Media ───────────────────────────────────
  { symbol: "T", name: "AT&T", sector: "Telecom", refPrice: 18.0, cap: "L" },
  { symbol: "VZ", name: "Verizon", sector: "Telecom", refPrice: 42.0, cap: "L" },
  { symbol: "TMUS", name: "T-Mobile", sector: "Telecom", refPrice: 200.0, cap: "L" },
  { symbol: "CMCSA", name: "Comcast", sector: "Telecom", refPrice: 40.0, cap: "L" },
  { symbol: "WBD", name: "Warner Bros Discovery", sector: "Telecom", refPrice: 9.0, cap: "M" },
  { symbol: "PARA", name: "Paramount Global", sector: "Telecom", refPrice: 12.0, cap: "M" },

  // ── REITs & Real Estate ───────────────────────────────
  { symbol: "AMT", name: "American Tower", sector: "REIT", refPrice: 210.0, cap: "L" },
  { symbol: "PLD", name: "Prologis", sector: "REIT", refPrice: 130.0, cap: "L" },
  { symbol: "CCI", name: "Crown Castle", sector: "REIT", refPrice: 110.0, cap: "L" },
  { symbol: "EQIX", name: "Equinix", sector: "REIT", refPrice: 830.0, cap: "L" },
  { symbol: "SPG", name: "Simon Property", sector: "REIT", refPrice: 155.0, cap: "L" },
  { symbol: "O", name: "Realty Income", sector: "REIT", refPrice: 55.0, cap: "L" },

  // ── Crypto & Blockchain ───────────────────────────────
  { symbol: "MSTR", name: "MicroStrategy", sector: "Crypto", refPrice: 1700.0, cap: "L" },
  { symbol: "MARA", name: "Marathon Digital", sector: "Crypto", refPrice: 25.0, cap: "M" },
  { symbol: "RIOT", name: "Riot Platforms", sector: "Crypto", refPrice: 13.0, cap: "S" },
  { symbol: "CLSK", name: "CleanSpark", sector: "Crypto", refPrice: 18.0, cap: "S" },
  { symbol: "HUT", name: "Hut 8 Mining", sector: "Crypto", refPrice: 20.0, cap: "S" },
  { symbol: "BITF", name: "Bitfarms", sector: "Crypto", refPrice: 3.0, cap: "S" },

  // ── Cannabis ──────────────────────────────────────────
  { symbol: "TLRY", name: "Tilray Brands", sector: "Cannabis", refPrice: 2.0, cap: "S" },
  { symbol: "CGC", name: "Canopy Growth", sector: "Cannabis", refPrice: 5.0, cap: "S" },

  // ── Materials & Mining ────────────────────────────────
  { symbol: "FCX", name: "Freeport-McMoRan", sector: "Materials", refPrice: 45.0, cap: "L" },
  { symbol: "NEM", name: "Newmont", sector: "Materials", refPrice: 42.0, cap: "L" },
  { symbol: "NUE", name: "Nucor", sector: "Materials", refPrice: 160.0, cap: "L" },
  { symbol: "CLF", name: "Cleveland-Cliffs", sector: "Materials", refPrice: 18.0, cap: "M" },
  { symbol: "AA", name: "Alcoa", sector: "Materials", refPrice: 30.0, cap: "M" },
  { symbol: "X", name: "United States Steel", sector: "Materials", refPrice: 35.0, cap: "M" },

  // ── Popular Meme / High-Vol ───────────────────────────
  { symbol: "GME", name: "GameStop", sector: "Meme", refPrice: 28.0, cap: "M" },
  { symbol: "AMC", name: "AMC Entertainment", sector: "Meme", refPrice: 5.0, cap: "S" },
  { symbol: "BBBY", name: "Bed Bath & Beyond", sector: "Meme", refPrice: 0.1, cap: "S" },
  { symbol: "SPCE", name: "Virgin Galactic", sector: "Meme", refPrice: 2.0, cap: "S" },
  { symbol: "CLOV", name: "Clover Health", sector: "Meme", refPrice: 1.5, cap: "S" },
  { symbol: "OPEN", name: "Opendoor", sector: "Meme", refPrice: 3.0, cap: "S" },
  { symbol: "WISH", name: "ContextLogic", sector: "Meme", refPrice: 6.0, cap: "S" },

  // ── SPACs / Growth ────────────────────────────────────
  { symbol: "DKNG", name: "DraftKings", sector: "Growth", refPrice: 42.0, cap: "M" },
  { symbol: "CRSP", name: "CRISPR Therapeutics", sector: "Growth", refPrice: 55.0, cap: "M" },
  { symbol: "CELH", name: "Celsius Holdings", sector: "Growth", refPrice: 30.0, cap: "M" },
  { symbol: "DUOL", name: "Duolingo", sector: "Growth", refPrice: 280.0, cap: "M" },
  { symbol: "TOST", name: "Toast", sector: "Growth", refPrice: 35.0, cap: "M" },
  { symbol: "CAVA", name: "CAVA Group", sector: "Growth", refPrice: 95.0, cap: "M" },
  { symbol: "BIRK", name: "Birkenstock", sector: "Growth", refPrice: 55.0, cap: "M" },

  // ── Cybersecurity ─────────────────────────────────────
  { symbol: "S", name: "SentinelOne", sector: "Cyber", refPrice: 25.0, cap: "M" },
  { symbol: "OKTA", name: "Okta", sector: "Cyber", refPrice: 100.0, cap: "M" },
  { symbol: "CYBR", name: "CyberArk", sector: "Cyber", refPrice: 290.0, cap: "M" },

  // ── ETFs (Popular) ────────────────────────────────────
  { symbol: "SPY", name: "S&P 500 ETF", sector: "ETF", refPrice: 530.0, cap: "L" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", sector: "ETF", refPrice: 460.0, cap: "L" },
  { symbol: "IWM", name: "Russell 2000 ETF", sector: "ETF", refPrice: 205.0, cap: "L" },
  { symbol: "DIA", name: "Dow Jones ETF", sector: "ETF", refPrice: 395.0, cap: "L" },
  { symbol: "ARKK", name: "ARK Innovation ETF", sector: "ETF", refPrice: 55.0, cap: "M" },
  { symbol: "XLF", name: "Financial Select ETF", sector: "ETF", refPrice: 42.0, cap: "L" },
  { symbol: "XLE", name: "Energy Select ETF", sector: "ETF", refPrice: 85.0, cap: "L" },
  { symbol: "XLK", name: "Tech Select ETF", sector: "ETF", refPrice: 210.0, cap: "L" },
  { symbol: "SOXX", name: "Semiconductor ETF", sector: "ETF", refPrice: 230.0, cap: "L" },
  { symbol: "GLD", name: "Gold ETF", sector: "ETF", refPrice: 220.0, cap: "L" },
  { symbol: "SLV", name: "Silver ETF", sector: "ETF", refPrice: 25.0, cap: "M" },
  { symbol: "TLT", name: "20+ Year Treasury ETF", sector: "ETF", refPrice: 95.0, cap: "L" },
  { symbol: "VIX", name: "Volatility Index", sector: "ETF", refPrice: 15.0, cap: "M" },
  { symbol: "SOXL", name: "3x Semis Bull ETF", sector: "ETF", refPrice: 35.0, cap: "M" },
  { symbol: "TQQQ", name: "3x Nasdaq Bull ETF", sector: "ETF", refPrice: 65.0, cap: "L" },
];

// ── Derived helpers ─────────────────────────────────────
export const US_SECTORS = Array.from(new Set(US_STOCKS.map((s) => s.sector)));

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

/** Tiger hot-pick 明星股票 — default watchlist (10 stocks) */
export const US_DEFAULT_SYMBOLS = [
  "NVDA", "TSLA", "AAPL", "MSFT", "META",
  "AMZN", "GOOGL", "AMD", "PLTR", "COIN",
] as const;

export const US_DEFAULT_STOCKS = US_DEFAULT_SYMBOLS
  .map((sym) => US_STOCKS.find((s) => s.symbol === sym)!)
  .filter(Boolean);
