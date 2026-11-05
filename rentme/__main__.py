"""CLI:  python -m rentme <command>

  update        scrape all sources, fetch details, filter, AI-rank new/changed listings
  update --no-ai
  rank [--force] AI-rank only (e.g. after editing preferences)
  list [-n 20]  print best matches in the terminal
  serve         web UI at http://127.0.0.1:8000 (settings, listings, AI chat)
  serve --lan   also reachable from your phone on the same Wi-Fi (protected by an access key)
  olx-url       print the OLX API URL for your filters (to open in your own browser)
  import-olx F  import OLX JSON saved from that URL
"""
from __future__ import annotations

import argparse
import json
import sys

from .pipeline import Config, apply_filter, rank, update


def _lan_ips() -> list[str]:
    """This computer's IPv4 addresses, home-Wi-Fi-looking ones (192.168.*) first."""
    import socket
    try:
        ips = socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        ips = []
    ips = [ip for ip in dict.fromkeys(ips) if not ip.startswith("127.")]
    return sorted(ips, key=lambda ip: (not ip.startswith("192.168."), not ip.startswith("172."), ip)) or ["127.0.0.1"]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="rentme")
    ap.add_argument("-c", "--config", default="config.json")
    sub = ap.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("update"); u.add_argument("--no-ai", action="store_true")
    r = sub.add_parser("rank"); r.add_argument("--force", action="store_true")
    l = sub.add_parser("list"); l.add_argument("-n", type=int, default=20)
    s = sub.add_parser("serve"); s.add_argument("--port", type=int, default=8000)
    s.add_argument("--lan", action="store_true", help="listen on the local network (phone access, needs the key)")
    s.add_argument("--new-key", action="store_true", help="with --lan: replace the access key (logs out other devices)")
    sub.add_parser("olx-url")
    i = sub.add_parser("import-olx"); i.add_argument("file")
    a = ap.parse_args()
    cfg = Config.load(a.config)
    if not cfg.path.exists():
        cfg.save()  # first run: write defaults (or migrate config.toml) to config.json

    if a.cmd == "update":
        update(cfg, use_ai=not a.no_ai)
    elif a.cmd == "rank":
        rank(cfg, force=a.force)
    elif a.cmd == "list":
        from .db import DB
        db = DB(cfg.db_path)
        rows = db.rows("active=1 AND filter_ok=1 AND status!='rejected' ORDER BY ai_score IS NULL, ai_score DESC LIMIT ?", (a.n,))
        for row in rows:
            d = json.loads(row["data"])
            ai = json.loads(row["ai_json"]) if row["ai_json"] else {}
            loc = ", ".join(x for x in (d["location"].get("district"), d["location"].get("city")) if x)
            print(f"{row['ai_score'] if row['ai_score'] is not None else '--':>3}  {d['total_price'] or '?':>6} zł  "
                  f"{d['area_m2'] or '?'} m²  {d['rooms'] or '?'}p  {loc}  [{d['source']}]")
            print(f"     {d['title']}")
            if ai.get("summary"):
                print(f"     {ai['summary']}")
            print(f"     {d['url']}\n")
    elif a.cmd == "serve":
        import uvicorn
        from .web import create_app
        if not a.lan:
            uvicorn.run(create_app(cfg), host="127.0.0.1", port=a.port)
            return
        token = cfg.access_token(new=a.new_key)
        ips = _lan_ips()
        print()
        print("  rentme is reachable on your local network.")
        print(f"  On this computer:  http://127.0.0.1:{a.port}")
        print("  On your phone (same Wi-Fi), open once:")
        print()
        print(f"      http://{ips[0]}:{a.port}/?key={token}")
        for ip in ips[1:]:
            print(f"      (or, if that doesn't load: http://{ip}:{a.port}/?key={token})")
        print()
        print("  The key is remembered on the phone after that. Anyone with this link can use the app")
        print("  (and your API credits), so don't share it. Rotate it with: serve --lan --new-key")
        print("  If Windows asks about the firewall, allow access on *Private* networks.")
        print()
        uvicorn.run(create_app(cfg, access_token=token), host="0.0.0.0", port=a.port)
    elif a.cmd == "olx-url":
        from .http import Http
        from .sources import Olx
        print(Olx(Http(), cfg.sources.get("olx_city_id") or None).api_url(cfg.filters))
    elif a.cmd == "import-olx":
        from .db import DB
        from .http import Http
        from .sources import Olx
        from .pipeline import import_olx
        r = import_olx(cfg, DB(cfg.db_path), json.loads(open(a.file, encoding="utf-8").read()))
        print(f"imported {r['imported']} OLX listings ({r['new']} new, {r['passing_filters']} pass your filters, "
              f"{r['otodom_mirrors_skipped']} Otodom copies skipped); run `python -m rentme rank` to AI-rank them")


if __name__ == "__main__":
    main()
