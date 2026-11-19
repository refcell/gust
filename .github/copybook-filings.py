"""Curated funds' 13F-HR and 13F-HR/A filings on EDGAR's current feed that the published data doesn't have yet.

Prints one accession per line: filed by a fund in the published index.json, accepted in the last 6 hours, and not in
that fund's filing_accessions. copybook-keepalive.yml polls this every minute and dispatches a curated filing run for
each new accession (cycle plan, Nov 19). Stdlib only; one SEC request per call.
"""
import json, re, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

UA = "Copybook factordynamics.com copybook@factordynamics.com"
FEED = ("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=13F-HR&company=&dateb=&owner=include"
        "&start=0&count=100&output=atom")
INDEX = "https://refcell.github.io/gust/copybook/data/index.json"


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
        return r.read()


def main() -> None:
    have = {m["cik"].lstrip("0"): set(m.get("filing_accessions") or [])
            for m in json.loads(get(f"{INDEX}?t={int(time.time())}"))["managers"]}
    since = datetime.now(timezone.utc) - timedelta(hours=6)
    for e in re.findall(r"<entry>(.*?)</entry>", get(FEED).decode(), re.S):
        title = re.search(r"<title>(.*?)</title>", e).group(1)
        cik = re.search(r"\((\d{10})\) \(Filer\)", title)
        acc = re.search(r"AccNo:</b> ([\d-]+)", e) or re.search(r"/(\d{10}-\d{2}-\d{6})-index", e)
        upd = datetime.fromisoformat(re.search(r"<updated>(.*?)</updated>", e).group(1))
        if title.startswith("13F-HR") and cik and acc and upd >= since:
            c = cik.group(1).lstrip("0")
            if c in have and acc.group(1) not in have[c]:
                print(acc.group(1))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - the next poll retries
        print(f"poll failed: {exc}", file=sys.stderr)
