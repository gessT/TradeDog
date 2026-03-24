"use client";

import { useState } from "react";

type NavbarProps = {
  symbol: string;
  loading: boolean;
  onSymbolChange: (value: string) => void;
  onRefresh: () => void;
};


type StockEntry = { symbol: string; name: string };
type SectorGroup = { label: string; stocks: StockEntry[] };

type Country = "US" | "MY";

const COUNTRIES: { code: Country; label: string; flag: string }[] = [
  { code: "US", label: "United States", flag: "🇺🇸" },
  { code: "MY", label: "Malaysia", flag: "🇲🇾" },
];

const US_SECTORS: SectorGroup[] = [
  {
    label: "🔥 Hot Picks",
    stocks: [
      { symbol: "NVDA", name: "NVIDIA" },
      { symbol: "TSLA", name: "Tesla" },
      { symbol: "PLTR", name: "Palantir" },
      { symbol: "SMCI", name: "Super Micro" },
      { symbol: "MSTR", name: "MicroStrategy" },
      { symbol: "ARM", name: "ARM Holdings" },
    ],
  },
  {
    label: "💻 Technology",
    stocks: [
      { symbol: "AAPL", name: "Apple" },
      { symbol: "MSFT", name: "Microsoft" },
      { symbol: "GOOGL", name: "Alphabet" },
      { symbol: "META", name: "Meta" },
      { symbol: "ORCL", name: "Oracle" },
      { symbol: "CRM", name: "Salesforce" },
      { symbol: "ADBE", name: "Adobe" },
      { symbol: "INTC", name: "Intel" },
    ],
  },
  {
    label: "🤖 AI & Semiconductors",
    stocks: [
      { symbol: "NVDA", name: "NVIDIA" },
      { symbol: "AMD", name: "AMD" },
      { symbol: "AVGO", name: "Broadcom" },
      { symbol: "TSM", name: "TSMC" },
      { symbol: "QCOM", name: "Qualcomm" },
      { symbol: "MU", name: "Micron" },
      { symbol: "MRVL", name: "Marvell" },
      { symbol: "SNPS", name: "Synopsys" },
    ],
  },
  {
    label: "🛒 Consumer & E-commerce",
    stocks: [
      { symbol: "AMZN", name: "Amazon" },
      { symbol: "WMT", name: "Walmart" },
      { symbol: "COST", name: "Costco" },
      { symbol: "HD", name: "Home Depot" },
      { symbol: "NKE", name: "Nike" },
      { symbol: "SBUX", name: "Starbucks" },
      { symbol: "MCD", name: "McDonald's" },
    ],
  },
  {
    label: "🏥 Healthcare",
    stocks: [
      { symbol: "UNH", name: "UnitedHealth" },
      { symbol: "JNJ", name: "Johnson & Johnson" },
      { symbol: "LLY", name: "Eli Lilly" },
      { symbol: "PFE", name: "Pfizer" },
      { symbol: "ABBV", name: "AbbVie" },
      { symbol: "MRK", name: "Merck" },
      { symbol: "TMO", name: "Thermo Fisher" },
    ],
  },
  {
    label: "🏦 Finance",
    stocks: [
      { symbol: "JPM", name: "JPMorgan" },
      { symbol: "V", name: "Visa" },
      { symbol: "MA", name: "Mastercard" },
      { symbol: "BAC", name: "Bank of America" },
      { symbol: "GS", name: "Goldman Sachs" },
      { symbol: "BRK-B", name: "Berkshire B" },
    ],
  },
  {
    label: "⚡ Energy",
    stocks: [
      { symbol: "XOM", name: "ExxonMobil" },
      { symbol: "CVX", name: "Chevron" },
      { symbol: "COP", name: "ConocoPhillips" },
      { symbol: "NEE", name: "NextEra Energy" },
      { symbol: "ENPH", name: "Enphase" },
    ],
  },
  {
    label: "📡 Communication",
    stocks: [
      { symbol: "NFLX", name: "Netflix" },
      { symbol: "DIS", name: "Disney" },
      { symbol: "CMCSA", name: "Comcast" },
      { symbol: "T", name: "AT&T" },
      { symbol: "VZ", name: "Verizon" },
    ],
  },
  {
    label: "🏭 Industrial & Storage",
    stocks: [
      { symbol: "CAT", name: "Caterpillar" },
      { symbol: "BA", name: "Boeing" },
      { symbol: "UPS", name: "UPS" },
      { symbol: "HON", name: "Honeywell" },
      { symbol: "STX", name: "Seagate" },
      { symbol: "WDC", name: "Western Digital" },
    ],
  },
  {
    label: "📈 ETFs",
    stocks: [
      { symbol: "SPY", name: "S&P 500" },
      { symbol: "QQQ", name: "Nasdaq 100" },
      { symbol: "DIA", name: "Dow Jones" },
      { symbol: "IWM", name: "Russell 2000" },
      { symbol: "SOXX", name: "Semiconductor" },
      { symbol: "XLK", name: "Tech Select" },
    ],
  },
];

const MY_SECTORS: SectorGroup[] = [
  {
    label: "🔥 Popular",
    stocks: [
      { symbol: "1155.KL", name: "Maybank" },
      { symbol: "1295.KL", name: "Public Bank" },
      { symbol: "6888.KL", name: "CIMB" },
      { symbol: "3182.KL", name: "Genting Bhd" },
      { symbol: "4715.KL", name: "Genting Malaysia" },
      { symbol: "5347.KL", name: "Tenaga Nasional" },
    ],
  },
  {
    label: "🏦 Banking & Finance",
    stocks: [
      { symbol: "1155.KL", name: "Maybank" },
      { symbol: "1295.KL", name: "Public Bank" },
      { symbol: "6888.KL", name: "CIMB" },
      { symbol: "5819.KL", name: "Hong Leong Bank" },
      { symbol: "1066.KL", name: "RHB Bank" },
      { symbol: "5185.KL", name: "AMMB" },
      { symbol: "8583.KL", name: "Alliance Bank" },
    ],
  },
  {
    label: "🛢️ Oil & Gas",
    stocks: [
      { symbol: "5183.KL", name: "Petronas Chemicals" },
      { symbol: "6033.KL", name: "Petronas Gas" },
      { symbol: "5681.KL", name: "Petronas Dagangan" },
      { symbol: "5218.KL", name: "Sapura Energy" },
      { symbol: "7052.KL", name: "Dialog Group" },
      { symbol: "7293.KL", name: "Yinson" },
    ],
  },
  {
    label: "🏗️ Construction & Property",
    stocks: [
      { symbol: "5398.KL", name: "Gamuda" },
      { symbol: "1023.KL", name: "CIMB" },
      { symbol: "5148.KL", name: "IJM Corp" },
      { symbol: "1724.KL", name: "PKINK" },
      { symbol: "5202.KL", name: "MSC" },
      { symbol: "5053.KL", name: "OSK Holdings" },
    ],
  },
  {
    label: "📱 Technology",
    stocks: [
      { symbol: "0166.KL", name: "Inari Amertron" },
      { symbol: "0072.KL", name: "Unisem" },
      { symbol: "0023.KL", name: "Datasonic" },
      { symbol: "0138.KL", name: "MyEG Services" },
      { symbol: "0041.KL", name: "Malaysian Pacific Industries" },
      { symbol: "0082.KL", name: "Vitrox" },
    ],
  },
  {
    label: "🏭 Plantation",
    stocks: [
      { symbol: "4197.KL", name: "Sime Darby" },
      { symbol: "2445.KL", name: "KLK" },
      { symbol: "5285.KL", name: "Sime Darby Plantation" },
      { symbol: "2291.KL", name: "Genting Plantations" },
      { symbol: "6947.KL", name: "FGV Holdings" },
      { symbol: "1961.KL", name: "IOI Corp" },
    ],
  },
  {
    label: "📡 Telecommunications",
    stocks: [
      { symbol: "6947.KL", name: "Axiata Group" },
      { symbol: "6012.KL", name: "Maxis" },
      { symbol: "4863.KL", name: "TM (Telekom)" },
      { symbol: "6742.KL", name: "YTL Power" },
      { symbol: "0078.KL", name: "CelcomDigi" },
    ],
  },
  {
    label: "🛒 Consumer",
    stocks: [
      { symbol: "3336.KL", name: "Nestle Malaysia" },
      { symbol: "4707.KL", name: "Petronas Chemicals" },
      { symbol: "2828.KL", name: "Dutch Lady" },
      { symbol: "6599.KL", name: "AEON" },
      { symbol: "5296.KL", name: "MR DIY" },
      { symbol: "5196.KL", name: "Berjaya Corp" },
    ],
  },
  {
    label: "🏥 Healthcare",
    stocks: [
      { symbol: "5225.KL", name: "IHH Healthcare" },
      { symbol: "7153.KL", name: "Kossan Rubber" },
      { symbol: "7113.KL", name: "Top Glove" },
      { symbol: "5168.KL", name: "Hartalega" },
      { symbol: "7084.KL", name: "QL Resources" },
    ],
  },
];

const COUNTRY_SECTORS: Record<Country, SectorGroup[]> = {
  US: US_SECTORS,
  MY: MY_SECTORS,
};

const COUNTRY_DEFAULT_SYMBOL: Record<Country, string> = {
  US: "AAPL",
  MY: "1155.KL",
};


export default function Navbar({ symbol, loading, onSymbolChange, onRefresh }: NavbarProps) {
  const [country, setCountry] = useState<Country>("MY");

  const sectors = COUNTRY_SECTORS[country];

  const handleCountryChange = (newCountry: Country) => {
    setCountry(newCountry);
    onSymbolChange(COUNTRY_DEFAULT_SYMBOL[newCountry]);
  };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-800/60 bg-slate-950/95 backdrop-blur px-4 py-2 md:px-6">
      <h1 className="text-base font-semibold text-slate-100">📊 Market Dashboard</h1>

      <div className="flex flex-wrap items-center gap-2">
        {/* Country selector */}
        <select
          value={country}
          onChange={(event) => handleCountryChange(event.target.value as Country)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 transition focus:ring-2"
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.label}
            </option>
          ))}
        </select>

        {/* Stock selector */}
        <select
          value={symbol}
          onChange={(event) => onSymbolChange(event.target.value)}
          className="min-w-[200px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 transition focus:ring-2"
        >
          {sectors.map((sector) => (
            <optgroup key={sector.label} label={sector.label}>
              {sector.stocks.map((s) => (
                <option key={`${sector.label}-${s.symbol}`} value={s.symbol}>
                  {s.symbol} — {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
        >
          {loading ? "Loading" : "Refresh"}
        </button>
      </div>
    </header>
  );
}