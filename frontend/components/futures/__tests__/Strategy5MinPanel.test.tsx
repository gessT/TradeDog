/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Strategy5MinPanel from '../Strategy5MinPanel';

// Mock the API service
jest.mock('../../../services/api', () => ({
  fetchMGC5MinBacktest: jest.fn(),
  load5MinConditionPresets: jest.fn(),
  save5MinConditionPreset: jest.fn(),
  delete5MinConditionPreset: jest.fn(),
}));

// Mock hooks
jest.mock('../../../hooks/useLivePrice', () => ({
  useLivePrice: () => ({ price: 2450.5, lastUpdate: new Date() }),
}));

describe('Strategy5MinPanel - Period Selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should show 7 days of trade log when 7d period is selected', async () => {
    const { fetchMGC5MinBacktest } = require('../../../services/api');
    
    // Mock backtest response with 7 days of trades
    const mockTrades = [
      // Day 1 (today)
      { entry_time: '2026-04-18T09:00:00', exit_time: '2026-04-18T10:00:00', pnl: 100, direction: 'CALL' },
      { entry_time: '2026-04-18T11:00:00', exit_time: '2026-04-18T12:00:00', pnl: -50, direction: 'PUT' },
      // Day 2
      { entry_time: '2026-04-17T09:00:00', exit_time: '2026-04-17T10:00:00', pnl: 75, direction: 'CALL' },
      // Day 3
      { entry_time: '2026-04-16T09:00:00', exit_time: '2026-04-16T10:00:00', pnl: 120, direction: 'CALL' },
      // Day 4
      { entry_time: '2026-04-15T09:00:00', exit_time: '2026-04-15T10:00:00', pnl: -30, direction: 'PUT' },
      // Day 5
      { entry_time: '2026-04-14T09:00:00', exit_time: '2026-04-14T10:00:00', pnl: 90, direction: 'CALL' },
      // Day 6
      { entry_time: '2026-04-13T09:00:00', exit_time: '2026-04-13T10:00:00', pnl: 60, direction: 'CALL' },
      // Day 7
      { entry_time: '2026-04-12T09:00:00', exit_time: '2026-04-12T10:00:00', pnl: 45, direction: 'CALL' },
    ];

    fetchMGC5MinBacktest.mockResolvedValue({
      trades: mockTrades,
      metrics: {
        total_trades: 8,
        win_rate: 75.0,
        total_return_pct: 5.2,
        max_drawdown_pct: 2.1,
        sharpe_ratio: 1.8,
        profit_factor: 2.5,
        avg_win: 88.75,
        avg_loss: 40.0,
      },
      candles: [],
      equity_curve: [],
      daily_pnl: [],
      params: {},
      data_source: 'Tiger',
    });

    render(<Strategy5MinPanel symbol="MGC" />);

    // Click 7d period button
    const period7dButton = screen.getByRole('button', { name: /7d/i });
    fireEvent.click(period7dButton);

    // Click "Run Backtest" button
    const runButton = screen.getByRole('button', { name: /run backtest/i });
    fireEvent.click(runButton);

    // Wait for data to load
    await waitFor(() => {
      expect(fetchMGC5MinBacktest).toHaveBeenCalledWith(
        expect.objectContaining({
          period: '7d',
        })
      );
    });

    // Verify all 8 trades are shown (covering 7 days)
    await waitFor(() => {
      const tradeRows = screen.getAllByTestId(/trade-row-/);
      expect(tradeRows.length).toBe(8);
    });

    // Verify the date range spans 7 days
    const oldestTradeDate = '2026-04-12';
    const newestTradeDate = '2026-04-18';
    
    expect(screen.getByText(new RegExp(oldestTradeDate))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(newestTradeDate))).toBeInTheDocument();
  });

  it('should use Tiger data source for 7d period', async () => {
    const { fetchMGC5MinBacktest } = require('../../../services/api');
    
    fetchMGC5MinBacktest.mockResolvedValue({
      trades: [],
      metrics: { total_trades: 0 },
      candles: [],
      equity_curve: [],
      daily_pnl: [],
      params: {},
      data_source: 'Tiger',
    });

    render(<Strategy5MinPanel symbol="MGC" />);

    const period7dButton = screen.getByRole('button', { name: /7d/i });
    fireEvent.click(period7dButton);

    const runButton = screen.getByRole('button', { name: /run backtest/i });
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(fetchMGC5MinBacktest).toHaveBeenCalled();
    });

    // Verify Tiger badge is displayed
    await waitFor(() => {
      expect(screen.getByText(/⚡ Tiger/i)).toBeInTheDocument();
    });
  });

  it('should filter trades within 7d window when date range is not specified', async () => {
    const { fetchMGC5MinBacktest } = require('../../../services/api');
    
    // Mock trades that include data outside 7d window
    const allTrades = [
      { entry_time: '2026-04-18T09:00:00', pnl: 100, direction: 'CALL' },
      { entry_time: '2026-04-10T09:00:00', pnl: 50, direction: 'CALL' }, // 8 days ago - should be filtered
      { entry_time: '2026-04-05T09:00:00', pnl: 75, direction: 'CALL' }, // 13 days ago - should be filtered
    ];

    fetchMGC5MinBacktest.mockResolvedValue({
      trades: allTrades.slice(0, 1), // API returns only trades within 7d
      metrics: { total_trades: 1 },
      candles: [],
      equity_curve: [],
      daily_pnl: [],
      params: {},
      data_source: 'Tiger',
    });

    render(<Strategy5MinPanel symbol="MGC" />);

    const period7dButton = screen.getByRole('button', { name: /7d/i });
    fireEvent.click(period7dButton);

    const runButton = screen.getByRole('button', { name: /run backtest/i });
    fireEvent.click(runButton);

    await waitFor(() => {
      const tradeRows = screen.queryAllByTestId(/trade-row-/);
      expect(tradeRows.length).toBe(1);
    });
  });

  it('should show loading state while fetching 7d data', async () => {
    const { fetchMGC5MinBacktest } = require('../../../services/api');
    
    // Create a promise that we can control
    let resolveBacktest: (value: any) => void;
    const backtestPromise = new Promise((resolve) => {
      resolveBacktest = resolve;
    });
    
    fetchMGC5MinBacktest.mockReturnValue(backtestPromise);

    render(<Strategy5MinPanel symbol="MGC" />);

    const period7dButton = screen.getByRole('button', { name: /7d/i });
    fireEvent.click(period7dButton);

    const runButton = screen.getByRole('button', { name: /run backtest/i });
    fireEvent.click(runButton);

    // Verify loading state appears
    await waitFor(() => {
      expect(screen.getByText(/fetching.*7d.*data/i)).toBeInTheDocument();
    });

    // Resolve the promise
    resolveBacktest!({
      trades: [],
      metrics: { total_trades: 0 },
      candles: [],
      equity_curve: [],
      daily_pnl: [],
      params: {},
      data_source: 'Tiger',
    });

    // Verify loading state disappears
    await waitFor(() => {
      expect(screen.queryByText(/fetching.*7d.*data/i)).not.toBeInTheDocument();
    });
  });

  it('should display correct metrics for 7d period', async () => {
    const { fetchMGC5MinBacktest } = require('../../../services/api');
    
    fetchMGC5MinBacktest.mockResolvedValue({
      trades: [
        { entry_time: '2026-04-18T09:00:00', pnl: 100, direction: 'CALL' },
        { entry_time: '2026-04-17T09:00:00', pnl: -50, direction: 'PUT' },
        { entry_time: '2026-04-16T09:00:00', pnl: 150, direction: 'CALL' },
      ],
      metrics: {
        total_trades: 3,
        win_rate: 66.7,
        total_return_pct: 4.0,
        max_drawdown_pct: 1.5,
        sharpe_ratio: 2.1,
        profit_factor: 3.0,
        avg_win: 125.0,
        avg_loss: 50.0,
      },
      candles: [],
      equity_curve: [],
      daily_pnl: [],
      params: {},
      data_source: 'Tiger',
    });

    render(<Strategy5MinPanel symbol="MGC" />);

    const period7dButton = screen.getByRole('button', { name: /7d/i });
    fireEvent.click(period7dButton);

    const runButton = screen.getByRole('button', { name: /run backtest/i });
    fireEvent.click(runButton);

    // Verify metrics are displayed
    await waitFor(() => {
      expect(screen.getByText(/66\.7%/)).toBeInTheDocument(); // Win rate
      expect(screen.getByText(/4\.0%/)).toBeInTheDocument(); // Return
      expect(screen.getByText(/3\.0/)).toBeInTheDocument(); // Profit factor
    });
  });
});
