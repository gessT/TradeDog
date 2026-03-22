import json

with open("apple_stock.json", "r") as f:
    raw = json.load(f)

before = len(raw["data"])
raw["data"] = [r for r in raw["data"] if r["Date"] >= "2020-01-01"]
raw["rows"] = len(raw["data"])
print(f"Before: {before} rows, After: {raw['rows']} rows")

with open("apple_stock.json", "w") as f:
    json.dump(raw, f, indent=2)

print("Done")
