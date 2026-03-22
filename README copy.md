# Backtest Workspace (Front + Back)

This workspace is restructured into a frontend and backend layout.

## Folder Structure

- front: Next.js dashboard UI.
- back: FastAPI backend, Python environment, and backend assets.

Current root contains one extra locked folder:

- frontend: old folder kept by a running process lock.

After closing any external Node process, remove it with:

```powershell
Remove-Item -Recurse -Force .\frontend
```

Then root will contain only:

- front
- back
- README.md

## Run Backend

```powershell
Set-Location .\back
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
```

## Run Frontend

```powershell
Set-Location .\front
$env:NEXT_PUBLIC_API_BASE = "http://127.0.0.1:8010"
npx next dev -p 3000
```

## Build Frontend

```powershell
Set-Location .\front
npm run build
```

## Notes Before Push

- Confirm old locked folder .\frontend is removed.
- Confirm app runs from .\back and UI runs from .\front.
- If ports are in use, change backend and frontend ports consistently.