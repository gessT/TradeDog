import requests
r = requests.get('http://localhost:8000/stock/backtest_tpc', params={'symbol': '5326.KL', 'period': '5y'})
print('Status:', r.status_code)
d = r.json()
print('Candles:', len(d['candles']), 'Trades:', len(d['trades']))
m = d['metrics']
print(f"WR: {m['win_rate']}% Return: {m['total_return_pct']}%")
for t in d['trades']:
    print(f"  {t['entry_time']} -> {t['exit_time']} {t['reason']} PnL:{t['pnl']}")
