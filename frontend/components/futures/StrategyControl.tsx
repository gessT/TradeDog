"use client";

type BuiltInPreset = {
  name: string;
  desc: string;
  toggles: Record<string, boolean>;
  sl: number;
  tp: number;
  interval: string;
  endpoint?: string;
};

type ConditionDef = {
  key: string;
  label: string;
  desc: string;
  group: string;
};

export type StrategyControlProps = {
  BUILT_IN_PRESETS: BuiltInPreset[];
  activePreset: string | null;
  onApplyPreset: (preset: BuiltInPreset) => void;
  slMult: number;
  onSlChange: (value: number) => void;
  tpMult: number;
  onTpChange: (value: number) => void;
  interval: string;
  onIntervalChange: (value: string) => void;
  conditionsOpen: boolean;
  onToggleConditions: () => void;
  conditionToggles: Record<string, boolean>;
  CONDITION_DEFS: ConditionDef[];
};

export default function StrategyControl({
  BUILT_IN_PRESETS,
  activePreset,
  onApplyPreset,
  slMult,
  onSlChange,
  tpMult,
  onTpChange,
  interval,
  onIntervalChange,
  conditionsOpen,
  onToggleConditions,
  conditionToggles,
  CONDITION_DEFS,
}: Readonly<StrategyControlProps>) {
  const conditionCount = Object.values(conditionToggles).filter(Boolean).length;

  // Strategy concepts mapping
  const CONCEPTS: Record<string, { icon: string; label: string }[]> = {
    "⬆ BoS Long": [
      { icon: "📈", label: "1H EMA 上升趋势" },
      { icon: "〰️", label: "5m 价格在 EMA50 上方" },
      { icon: "💥", label: "收盘突破 N棒最高点 (BoS)" },
      { icon: "🌀", label: "Supertrend 多头" },
      { icon: "⚡", label: "RSI 动能确认" },
      { icon: "🕐", label: "活跃交易时段" },
    ],
    "⬇ BoS Short": [
      { icon: "📉", label: "1H EMA 下降趋势" },
      { icon: "〰️", label: "5m 价格在 EMA50 下方" },
      { icon: "💥", label: "收盘跌破 N棒最低点 (BoS)" },
      { icon: "🌀", label: "Supertrend 空头" },
      { icon: "⚡", label: "RSI 动能确认" },
      { icon: "🕐", label: "活跃交易时段" },
    ],
    "⇕ BoS Mix": [
      { icon: "🔄", label: "多空双向交易" },
      { icon: "💥", label: "价格突破结构高点→做多" },
      { icon: "💥", label: "价格跌破结构低点→做空" },
      { icon: "🌀", label: "Supertrend 过滤方向" },
      { icon: "〰️", label: "EMA50 趋势确认" },
      { icon: "🕐", label: "活跃时段 · ATR 过滤震荡" },
    ],
    " Always Open": [
      { icon: "🧪", label: "TEST 模式" },
      { icon: "🔁", label: "每次 bar close 必进场" },
      { icon: "⬆", label: "固定做多方向" },
      { icon: "🎯", label: "固定 SL/TP = 3 ATR" },
    ],
  };

  return (
    <div className="px-2 mb-1.5 relative">
      <div className="rounded-lg border border-slate-600/50 bg-slate-800/70 overflow-visible relative isolate">
        {/* Title header */}
        <div className="flex items-center border-b border-slate-700/50 px-2 py-1 bg-slate-900/40 rounded-t-lg">
          <span className="text-[8px] uppercase tracking-widest text-slate-500 font-bold">Control</span>
          <span className="ml-1 text-[7px] text-slate-600">
            · Hover preset for details
          </span>
        </div>

        {/* One-row control strip */}
        <div className="px-2 py-1.5 flex items-center gap-2 flex-wrap [overflow:visible]">
          {/* Left: Preset buttons */}
          <div className="flex items-center gap-1 overflow-visible">
          {BUILT_IN_PRESETS.map((bp) => {
            const steps = CONCEPTS[bp.name];
            return (
              <div key={bp.name} className="relative group/preset overflow-visible">
                <button
                  onClick={() => onApplyPreset(bp)}
                  className={`px-2 py-1 text-[9px] font-bold rounded-md border transition-all ${
                    activePreset === bp.name
                      ? "bg-cyan-900/40 border-cyan-600/60 text-cyan-300"
                      : "bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-500/60 hover:text-slate-200"
                  }`}
                  title={bp.desc}
                >
                  {bp.name}
                </button>
                
                {/* Tooltip for this preset */}
                {steps && (
                  <div className="absolute top-[calc(100%+6px)] left-0 hidden group-hover/preset:block w-max min-w-full max-w-[400px] px-3 py-2 rounded-lg bg-slate-900 border border-slate-600/80 shadow-2xl z-[999] pointer-events-none">
                    <div className="text-[9px] font-bold text-cyan-300 mb-1.5">{bp.name}</div>
                    <div className="flex flex-col gap-1 text-[8px]">
                      {steps.map((s, idx) => (
                        <span key={`${bp.name}-${idx}`} className="flex items-center gap-1.5">
                          <span className="shrink-0">{s.icon}</span>
                          <span className="text-slate-200">{s.label}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-slate-700/60 shrink-0" />

        {/* Middle: SL/TP/Interval */}
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-1 text-[9px]">
            <span className="text-rose-400 font-bold">SL</span>
            <input
              type="number"
              min="0.5"
              max="10"
              step="0.5"
              value={slMult}
              onChange={(e) => onSlChange(parseFloat(e.target.value) || slMult)}
              className="w-10 bg-slate-900 border border-slate-700/60 rounded px-1 py-0.5 text-[9px] text-rose-300 font-bold text-right focus:outline-none focus:border-rose-500/60"
              style={{ colorScheme: "dark" }}
            />
            <span className="text-slate-500">×</span>
          </label>
          <label className="flex items-center gap-1 text-[9px]">
            <span className="text-emerald-400 font-bold">TP</span>
            <input
              type="number"
              min="0.5"
              max="10"
              step="0.5"
              value={tpMult}
              onChange={(e) => onTpChange(parseFloat(e.target.value) || tpMult)}
              className="w-10 bg-slate-900 border border-slate-700/60 rounded px-1 py-0.5 text-[9px] text-emerald-300 font-bold text-right focus:outline-none focus:border-emerald-500/60"
              style={{ colorScheme: "dark" }}
            />
            <span className="text-slate-500">×</span>
          </label>
          <select
            value={interval}
            onChange={(e) => onIntervalChange(e.target.value)}
            className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/50 text-slate-400 uppercase tracking-wider appearance-none cursor-pointer hover:border-cyan-600/50 focus:outline-none focus:border-cyan-600/50 transition-colors"
            style={{ colorScheme: "dark" }}
          >
            <option value="1m">1min</option>
            <option value="2m">2min</option>
            <option value="5m">5min</option>
            <option value="15m">15min</option>
          </select>
        </div>

        {/* Right: Conditions button */}
        <button
          onClick={onToggleConditions}
          title={`${conditionCount}/${CONDITION_DEFS.length} conditions enabled`}
          className={`relative px-2 py-1 rounded-md border flex items-center gap-1 transition-all ml-auto ${
            conditionsOpen
              ? "bg-cyan-900/40 border-cyan-600/60 text-cyan-400"
              : "bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-500/60 hover:text-slate-200"
          }`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <span className="text-[9px] font-bold">Conditions</span>
          {conditionCount > 0 && (
            <span className="ml-1 px-1 py-px rounded-full bg-cyan-600 text-[7px] text-white font-bold leading-none">
              {conditionCount}
            </span>
          )}
        </button>
      </div>
      </div>
    </div>
  );
}
