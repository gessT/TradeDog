import requests
r = requests.post('http://127.0.0.1:8000/backtest/run', json={
    'symbol': '1155.KL',
    'quantity': 1000,
    'buy_conditions': ['inverted_hammer_buy'],
    'sell_conditions': ['volume_boost_sell', 'stop_loss_5pct'],
    'buy_logic': 'OR',
    'sell_logic': 'OR',
    'start_date': '2020-01-01'
})
d = r.json()
s = d.get('summary', {})
print('Status:', r.status_code)
print(f"Trades: {s.get('count')}  Wins: {s.get('wins')}  PnL: {s.get('net_pnl')}")
for t in d.get('trades', []):
    print(f"  buy={t.get('buy_time','?')} sell={t.get('sell_time','?')} reason={t.get('sell_criteria','?')} pnl={t.get('pnl')}")
