# JPN Desktop (Python)

A native Windows desktop window for the existing JPN website. It reuses the current website, Supabase sign-in, dashboard, plans, and backend rather than maintaining a second copy of those features.

## Requirements

- Windows 10/11 (ARM64 or x64)
- Python 3.12 recommended
- Internet connection

## Run from source

Open PowerShell in this folder:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python main.py
```

If PowerShell blocks activation, run the app without activating the environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

The app stores its browser cookies and local website data under `%LOCALAPPDATA%\JPN`, so the user does not need to sign in every time.

## Important

This is the desktop shell. It displays the live JPN website in its own application window. It does not yet implement a system-wide VPN/TUN connection engine. The connection controls must not claim to connect until that engine is integrated and tested.
