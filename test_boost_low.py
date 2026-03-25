import requests
# Test cut_loss_boost_low with BAUTO
r = requests.post('http://127.0.0.1:8000/backtest/run', json={
    'symbol': '5248.KL',
    'quantity': 1000,
    'buy_conditions': ['inverted_hammer_buy'],
    'sell_conditions': ['cut_loss_boost_low', 'take_profit_2pct'],
    'buy_logic': 'OR',
    'sell_logic': 'OR',
    'start_date': '2020-01-01'
})
d = r.json() if r.status_code == 200 else {}
if r.status_code != 200:
    print(f"Status: {r.status_code}")
    print(r.text[:500])
else:
    s = d.get('summary', {})
print('=== BAUTO ===')
print(f"Status: {r.status_code}  Trades: {s.get('count')}  Wins: {s.get('wins')}  PnL: {s.get('net_pnl')}")
for t in d.get('trades', []):
    print(f"  buy={t.get('buy_time','?')} sell={t.get('sell_time','?')} reason={t.get('sell_criteria','?')} pnl={t.get('pnl')}")

# Test with Maybank
r2 = requests.post('http://127.0.0.1:8000/backtest/run', json={
    'symbol': '1155.KL',
    'quantity': 1000,
    'buy_conditions': ['inverted_hammer_buy'],
    'sell_conditions': ['cut_loss_boost_low', 'take_profit_2pct'],
    'buy_logic': 'OR',
    'sell_logic': 'OR',
    'start_date': '2020-01-01'
})
d2 = r2.json()
s2 = d2.get('summary', {})
print('\n=== Maybank ===')
print(f"Status: {r2.status_code}  Trades: {s2.get('count')}  Wins: {s2.get('wins')}  PnL: {s2.get('net_pnl')}")
for t in d2.get('trades', []):
    print(f"  buy={t.get('buy_time','?')} sell={t.get('sell_time','?')} reason={t.get('sell_criteria','?')} pnl={t.get('pnl')}")
