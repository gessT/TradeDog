"use client";

import { useCallback, useEffect, useState } from "react";
import FuturesDashboard from "../components/futures/FuturesDashboard";
import KLSEDashboard from "../components/klse/KLSEDashboard";
import USDashboard from "../components/us/USDashboard";

type Tab = "MY" | "US" | "FUTURES";

const TABS: { key: Tab; label: string; icon: string; color: string; activeColor: string }[] = [
  { key: "FUTURES", label: "Futures", icon: "📈", color: "text-amber-400", activeColor: "border-amber-400 bg-amber-500/5" },
  { key: "MY", label: "Malaysia", icon: "🇲🇾", color: "text-cyan-400", activeColor: "border-cyan-400 bg-cyan-500/5" },
  { key: "US", label: "US Stocks", icon: "🇺🇸", color: "text-blue-400", activeColor: "border-blue-400 bg-blue-500/5" },
];

export default function Page() {
  const [mode, setMode] = useState<Tab>("US");
  const [defaultTab, setDefaultTab] = useState<Tab>("US");
  const [visited, setVisited] = useState<Set<string>>(() => new Set(["US"]));
  const [configOpen, setConfigOpen] = useState(false);

  // Restore saved default tab after hydration
  useEffect(() => {
    const saved = localStorage.getItem("tradedog_default_tab") as Tab | null;
    if (saved) {
      setDefaultTab(saved);
      if (saved !== "US") {
        setMode(saved);
        setVisited((prev) => {
          if (prev.has(saved)) return prev;
          const next = new Set(prev);
          next.add(saved);
          return next;
        });
      }
    }
  }, []);

  const switchTab = useCallback((tab: Tab) => {
    setMode(tab);
    setVisited((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, []);

  const setDefaultDashboard = useCallback((tab: Tab) => {
    localStorage.setItem("tradedog_default_tab", tab);
    setDefaultTab(tab);
    setConfigOpen(false);
  }, []);

  // Close config on outside click
  useEffect(() => {
    if (!configOpen) return;
    const handler = () => setConfigOpen(false);
    const timer = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener("click", handler); };
  }, [configOpen]);

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col">
      {/* ── Top navigation bar ─────────── */}
      <div className="flex items-center border-b border-slate-800/60 bg-slate-900/60">
        {/* Dashboard tabs */}
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            className={`px-4 py-1.5 text-[11px] font-bold tracking-wide transition-colors ${
              mode === tab.key
                ? `${tab.color} border-b-2 ${tab.activeColor}`
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
            {defaultTab === tab.key && (
              <span className="ml-1 text-[8px] text-slate-500 align-top">●</span>
            )}
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Config button */}
        <div className="relative shrink-0 mr-2">
          <button
            onClick={(e) => { e.stopPropagation(); setConfigOpen((p) => !p); }}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition ${
              configOpen
                ? "bg-slate-700/60 text-slate-200"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="hidden sm:inline">Config</span>
          </button>

          {configOpen && (
            <div
              className="absolute top-full right-0 mt-1 w-56 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 border-b border-slate-800/60">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Configuration</span>
              </div>

              {/* Default Dashboard */}
              <div className="px-3 py-2">
                <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1.5">Default Dashboard</div>
                {TABS.map((tab) => {
                  const isDefault = defaultTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setDefaultDashboard(tab.key)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition mb-0.5 ${
                        isDefault
                          ? "bg-blue-500/10 border border-blue-500/30 text-blue-300"
                          : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border border-transparent"
                      }`}
                    >
                      <span className="text-sm">{tab.icon}</span>
                      <span className="text-[11px] font-semibold flex-1">{tab.label}</span>
                      {isDefault && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-bold">Default</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="px-3 py-2 border-t border-slate-800/40">
                <div className="text-[8px] text-slate-600 text-center">Settings saved to browser</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lazy mount: only render a tab after first visit, then keep it mounted */}
      <div className={`flex-1 overflow-hidden ${mode === "FUTURES" ? "flex" : "hidden"}`}>
        {visited.has("FUTURES") && <FuturesDashboard />}
      </div>
      <div className={`flex-1 overflow-hidden ${mode === "MY" ? "flex" : "hidden"}`}>
        {visited.has("MY") && <KLSEDashboard />}
      </div>
      <div className={`flex-1 overflow-hidden ${mode === "US" ? "flex" : "hidden"}`}>
        {visited.has("US") && <USDashboard />}
      </div>
    </main>
  );
}