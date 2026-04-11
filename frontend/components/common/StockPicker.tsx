"use client";

import { useRef, useState, useEffect, useCallback } from "react";

type StockEntry = { symbol: string; name: string };
type SectorGroup = { label: string; stocks: StockEntry[] };

interface Props {
  symbol: string;
  stockName: string;
  market: "MY" | "US";
  onSymbolChange: (symbol: string) => void;
}

const US_SECTORS: SectorGroup[] = [
  {
    label: "🔥 Hot Picks",
    stocks: [
      { symbol: "NVDA", name: "NVIDIA" },
      { symbol: "TSLA", name: "Tesla" },
      { symbol: "PLTR", name: "Palantir" },
      { symbol: "SMCI", name: "Super Micro" },
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
    ],
  },
  {
    label: "🛒 Consumer",
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
    ],
  },
  {
    label: "⚡ Energy",
    stocks: [
      { symbol: "XOM", name: "ExxonMobil" },
      { symbol: "CVX", name: "Chevron" },
      { symbol: "COP", name: "ConocoPhillips" },
      { symbol: "SLB", name: "Schlumberger" },
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
      { symbol: "TMUS", name: "T-Mobile" },
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
    ],
  },
];

const MY_SECTORS: SectorGroup[] = [
  {
    label: "🔥 Popular",
    stocks: [
      { symbol: "5248.KL", name: "Bermaz Auto" },
      { symbol: "1155.KL", name: "Maybank" },
      { symbol: "1295.KL", name: "Public Bank" },
      { symbol: "1023.KL", name: "CIMB" },
      { symbol: "5347.KL", name: "Tenaga Nasional" },
      { symbol: "3182.KL", name: "Genting Bhd" },
      { symbol: "4715.KL", name: "Genting Malaysia" },
    ],
  },
  {
    label: "🏦 Banking & Finance",
    stocks: [
      { symbol: "1155.KL", name: "Maybank" },
      { symbol: "1295.KL", name: "Public Bank" },
      { symbol: "1023.KL", name: "CIMB" },
      { symbol: "5819.KL", name: "Hong Leong Bank" },
      { symbol: "1066.KL", name: "RHB Bank" },
      { symbol: "1015.KL", name: "Ambank" },
      { symbol: "1082.KL", name: "Hong Leong Financial" },
      { symbol: "1818.KL", name: "Bursa Malaysia" },
    ],
  },
  {
    label: "📱 Technology",
    stocks: [
      { symbol: "0097.KL", name: "ViTrox" },
      { symbol: "0128.KL", name: "Frontken" },
      { symbol: "0166.KL", name: "Inari Amertron" },
      { symbol: "5005.KL", name: "Unisem" },
      { symbol: "0208.KL", name: "Greatech" },
      { symbol: "5292.KL", name: "UWC" },
      { symbol: "0270.KL", name: "Nationgate" },
      { symbol: "7160.KL", name: "Pentamaster" },
    ],
  },
  {
    label: "🛢️ Energy",
    stocks: [
      { symbol: "5183.KL", name: "Petronas Chemicals" },
      { symbol: "6033.KL", name: "Petronas Gas" },
      { symbol: "7277.KL", name: "Dialog Group" },
      { symbol: "7293.KL", name: "Yinson" },
      { symbol: "5199.KL", name: "Hibiscus Petroleum" },
      { symbol: "5141.KL", name: "Dayang Enterprise" },
    ],
  },
  {
    label: "🏗️ Construction",
    stocks: [
      { symbol: "5398.KL", name: "Gamuda" },
      { symbol: "5211.KL", name: "Sunway Bhd" },
      { symbol: "5263.KL", name: "Sunway Construction" },
      { symbol: "3336.KL", name: "IJM Corp" },
      { symbol: "7161.KL", name: "Kerjaya Prospek" },
    ],
  },
  {
    label: "🏭 Industrial",
    stocks: [
      { symbol: "8869.KL", name: "Press Metal" },
      { symbol: "5168.KL", name: "Hartalega" },
      { symbol: "7153.KL", name: "Kossan Rubber" },
      { symbol: "7113.KL", name: "Top Glove" },
      { symbol: "5286.KL", name: "Mi Technovation" },
    ],
  },
  {
    label: "🏥 Healthcare",
    stocks: [
      { symbol: "5225.KL", name: "IHH Healthcare" },
      { symbol: "5555.KL", name: "Sunway Healthcare" },
      { symbol: "5878.KL", name: "KPJ Healthcare" },
      { symbol: "5318.KL", name: "DXN Holdings" },
      { symbol: "7148.KL", name: "Duopharma Biotech" },
    ],
  },
  {
    label: "🏭 Plantation",
    stocks: [
      { symbol: "5285.KL", name: "SD Guthrie" },
      { symbol: "1961.KL", name: "IOI Corp" },
      { symbol: "2445.KL", name: "KLK" },
      { symbol: "2291.KL", name: "Genting Plantations" },
      { symbol: "2089.KL", name: "United Plantations" },
    ],
  },
  {
    label: "📡 Telco",
    stocks: [
      { symbol: "6947.KL", name: "CelcomDigi" },
      { symbol: "6012.KL", name: "Maxis" },
      { symbol: "4863.KL", name: "Telekom Malaysia" },
      { symbol: "6888.KL", name: "Axiata" },
    ],
  },
  {
    label: "⚡ Utilities",
    stocks: [
      { symbol: "5347.KL", name: "Tenaga Nasional" },
      { symbol: "6742.KL", name: "YTL Power" },
      { symbol: "4677.KL", name: "YTL Corp" },
      { symbol: "5209.KL", name: "Gas Malaysia" },
    ],
  },
  {
    label: "🛒 Consumer",
    stocks: [
      { symbol: "5326.KL", name: "99 Speed Mart" },
      { symbol: "4707.KL", name: "Nestle Malaysia" },
      { symbol: "5296.KL", name: "MR DIY" },
      { symbol: "7084.KL", name: "QL Resources" },
      { symbol: "7052.KL", name: "Padini" },
    ],
  },
  {
    label: "🏢 REIT",
    stocks: [
      { symbol: "5227.KL", name: "IGB REIT" },
      { symbol: "5176.KL", name: "Sunway REIT" },
      { symbol: "5212.KL", name: "Pavilion REIT" },
      { symbol: "5106.KL", name: "Axis REIT" },
    ],
  },
];

const SECTORS: Record<"MY" | "US", SectorGroup[]> = { MY: MY_SECTORS, US: US_SECTORS };

export default function StockPicker({ symbol, stockName, market, onSymbolChange }: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setSearch("");
    }
  }, [open]);

  const sectors = SECTORS[market];
  const q = search.toLowerCase();

  const filtered = q
    ? sectors
        .map((s) => ({
          ...s,
          stocks: s.stocks.filter(
            (st) => st.symbol.toLowerCase().includes(q) || st.name.toLowerCase().includes(q)
          ),
        }))
        .filter((s) => s.stocks.length > 0)
    : sectors;

  const handleSelect = useCallback(
    (sym: string) => {
      onSymbolChange(sym);
      setOpen(false);
    },
    [onSymbolChange]
  );

  const displayCode = market === "MY" ? symbol.replace(".KL", "") : symbol;

  return (
    <div ref={ref} className="relative">
      {/* Trigger button — shows current stock */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded px-2 py-0.5 hover:bg-slate-800/60 transition group"
      >
        <span className="text-sm font-bold text-slate-100 group-hover:text-cyan-300 transition">
          {displayCode}
        </span>
        {stockName && (
          <span className="text-[11px] text-slate-400 group-hover:text-slate-300 transition truncate max-w-[140px]">
            {stockName}
          </span>
        )}
        <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/40 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-slate-800">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search stock…"
              className="w-full rounded bg-slate-800 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-600"
            />
          </div>

          {/* Stock list */}
          <div className="max-h-[360px] overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-4">No stocks found</p>
            )}
            {filtered.map((sector) => (
              <div key={sector.label}>
                <div className="sticky top-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-900/95 border-b border-slate-800/40">
                  {sector.label}
                </div>
                {sector.stocks.map((s) => {
                  const code = market === "MY" ? s.symbol.replace(".KL", "") : s.symbol;
                  const isActive = s.symbol === symbol;
                  return (
                    <button
                      key={`${sector.label}-${s.symbol}`}
                      onClick={() => handleSelect(s.symbol)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-800/70 transition-colors ${
                        isActive ? "bg-cyan-900/20" : ""
                      }`}
                    >
                      <span className={`text-[11px] font-bold font-mono w-16 shrink-0 ${isActive ? "text-cyan-400" : "text-slate-300"}`}>
                        {code}
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">{s.name}</span>
                      {isActive && <span className="ml-auto text-[9px] text-cyan-500">●</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
