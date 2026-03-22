type NavbarProps = {
  symbol: string;
  loading: boolean;
  onSymbolChange: (value: string) => void;
  onRefresh: () => void;
};


const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "STX"];


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
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 transition focus:ring-2"
        >
          {DEFAULT_SYMBOLS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
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