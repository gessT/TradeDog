type NavbarProps = {
  symbol: string;
  loading: boolean;
  onSymbolChange: (value: string) => void;
  onRefresh: () => void;
};


type StockEntry = { symbol: string; name: string };

const SECTORS: { label: string; stocks: StockEntry[] }[] = [
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


export default function Navbar({ symbol, loading, onSymbolChange, onRefresh }: NavbarProps) {
  return (
    <header className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:flex-row md:items-center md:justify-between md:p-6">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-sky-400">Trading Monitor</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-100 md:text-3xl">Market Dashboard</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={symbol}
          onChange={(event) => onSymbolChange(event.target.value)}
          className="min-w-[200px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 transition focus:ring-2"
        >
          {SECTORS.map((sector) => (
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