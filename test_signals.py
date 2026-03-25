import requests
r = requests.post('http://127.0.0.1:8000/backtest/signals', json={
    'symbol': '1155.KL',
    'buy_conditions': ['inverted_hammer_buy'],
    'buy_logic': 'OR',
    'start_date': '2020-01-01'
})
print('Status:', r.status_code)
d = r.json()
print(f"Count: {d['count']}")
for s in d['signals']:
    print(f"  {s['date']}  price={s['price']}  wst={s['wst']}  ht={s['ht']}")
