"use client";

import { useState, useCallback } from "react";
import OptimizationDialog from "./OptimizationDialog";
import {
  optimize5MinConditions,
  save5MinConditionPreset,
  load5MinConditionPresets,
  type ConditionOptimizationResult,
  type Scan5MinConditions,
} from "../../services/api";

type ConditionDef = {
  key: keyof Scan5MinConditions;
  label: string;
  group: "5m" | "smc" | "structure";
  desc: string;
};

type ConditionOptimizerProps = {
  symbol: string;
  period: string;
  slMult: number;
  tpMult: number;
  interval: string;
  skipHours?: number[];
  maxLossPerTrade?: number;
  riskFilters: {
    skip_flat?: boolean;
    skip_counter_trend?: boolean;
    use_ema_exit?: boolean;
  };
  exitConditions: {
    use_struct_fade?: boolean;
    use_sma28_cut?: boolean;
  };
  conditionToggles: Record<string, boolean>;
  CONDITION_DEFS: ConditionDef[];
  disabled?: boolean;
  onApplyResult: (newToggles: Record<string, boolean>) => void;
  onPresetsUpdated: () => void;
};

/**
 * ConditionOptimizer - "⚡ Best 3" feature component
 * Runs condition optimization and displays results in a dialog
 */
export default function ConditionOptimizer({
  symbol,
  period,
  slMult,
  tpMult,
  interval,
  skipHours = [],
  maxLossPerTrade = 0,
  riskFilters,
  exitConditions,
  conditionToggles,
  CONDITION_DEFS,
  disabled = false,
  onApplyResult,
  onPresetsUpdated,
}: ConditionOptimizerProps) {
  const [optimizationResults, setOptimizationResults] = useState<ConditionOptimizationResult[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [showOptDialog, setShowOptDialog] = useState(false);

  const runConditionOptimization = useCallback(async () => {
    setOptimizing(true);
    setOptimizationResults([]);
    try {
      const results = await optimize5MinConditions(
        symbol,
        period,
        5,
        slMult,
        tpMult,
        riskFilters.skip_flat ?? false,
        riskFilters.skip_counter_trend ?? true,
        riskFilters.use_ema_exit ?? false,
        exitConditions.use_struct_fade ?? false,
        exitConditions.use_sma28_cut ?? false,
        skipHours.length > 0 ? skipHours : undefined,
        maxLossPerTrade,
        interval,
      );
      setOptimizationResults(results);
      if (results.length > 0) {
        setShowOptDialog(true);
        // Auto-save each result as a preset with a descriptive name
        const catLabels: Record<string, string> = {
          best_winrate: "Best WR",
          best_return: "Best Return",
          low_risk: "Low Risk",
        };
        for (const r of results) {
          const cat = r.category ?? "best";
          const label = catLabels[cat] ?? cat;
          const toggles: Record<string, boolean> = {};
          CONDITION_DEFS.forEach(def => {
            if (def.group === "5m" || def.group === "smc") {
              toggles[def.key] = r.conditions.includes(def.key);
            }
          });
          await save5MinConditionPreset(`⚡ ${label}`, toggles, symbol).catch(() => {});
        }
        // Notify parent to refresh presets list
        onPresetsUpdated();
      }
    } catch (e: unknown) {
      alert(`❌ Optimization failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setOptimizing(false);
    }
  }, [
    symbol,
    period,
    slMult,
    tpMult,
    riskFilters,
    exitConditions,
    skipHours,
    maxLossPerTrade,
    interval,
    CONDITION_DEFS,
    onPresetsUpdated,
  ]);

  const handleApplyResult = useCallback((result: ConditionOptimizationResult) => {
    const newToggles: Record<string, boolean> = {};
    CONDITION_DEFS.forEach(def => {
      if (def.group === "5m" || def.group === "smc") {
        newToggles[def.key] = result.conditions.includes(def.key);
      } else {
        newToggles[def.key] = conditionToggles[def.key];
      }
    });
    onApplyResult(newToggles);
    setShowOptDialog(false);
  }, [CONDITION_DEFS, conditionToggles, onApplyResult]);

  return (
    <>
      {/* Best 3 Button */}
      <button
        onClick={runConditionOptimization}
        disabled={optimizing || disabled}
        className="w-full px-3 py-1.5 text-[10px] font-bold text-left text-purple-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
      >
        ⚡ Best 3
      </button>

      {/* Optimization Dialog */}
      {showOptDialog && optimizationResults.length > 0 && (
        <OptimizationDialog
          results={optimizationResults}
          slMult={slMult}
          tpMult={tpMult}
          onApply={handleApplyResult}
          onClose={() => setShowOptDialog(false)}
        />
      )}
    </>
  );
}
