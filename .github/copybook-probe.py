"""Read-only probe of the restored h/ cache (Nov 19, Mizuho ORCL marker): which CUSIP fields a cached curated book keeps.

Prints, for one slug, each cached quarter's rows under the given issuer prefixes (codes and markers only, no values),
then counts across every cached curated book the lines matched to their prior quarter with cusip_pair null whose
prior row was merged (cusip_as_filed set or cusip_pair merged_misfiled), and rows that carry cusip_pair
merged_misfiled without cusip_as_filed. Runs only on dispatches whose reason starts with "probe". Remove after.
"""
import json, sys
from pathlib import Path

H = Path(sys.argv[1]) / "h"
SLUG, PREFIXES = sys.argv[2], tuple(sys.argv[3].split(","))
F = ("cusip", "cusip_as_filed", "cusip_pair", "prev_cusip", "filed_cusip", "change", "prev_shares")


def books(slug_dir: Path) -> list[tuple[str, dict]]:
    out = []
    for p in sorted(slug_dir.glob("*.json")):
        if p.name == "index.json" or p.name.endswith(".v1.json"):
            continue
        try:
            out.append((p.stem, json.loads(p.read_text())))
        except ValueError:
            pass
    return out


for q, b in books(H / SLUG):
    print(f"probe {SLUG} {q} accession={b.get('accession')} filing_key={b.get('filing_key')} format={b.get('format')}")
    for h in b.get("holdings") or []:
        if (h.get("cusip") or "")[:6] in PREFIXES and not h.get("put_call"):
            print("  ", {k: h.get(k) for k in F})

gap, marked_no_filed, slugs = [], 0, set()
for d in sorted(p for p in H.iterdir() if p.is_dir()):
    bs = books(d)
    for (q0, prev), (q1, cur) in zip(bs, bs[1:]):
        before = {h["cusip"]: h for h in prev.get("holdings") or [] if not h.get("put_call")}
        for h in cur.get("holdings") or []:
            if h.get("put_call"):
                continue
            if h.get("cusip_pair") == "merged_misfiled" and not h.get("cusip_as_filed") and h.get("filed_cusip") == h.get("cusip"):
                marked_no_filed += 1
            p = before.get(h["cusip"])
            if p and h.get("prev_shares") is not None and not h.get("cusip_pair") \
                    and (p.get("cusip_as_filed") or p.get("cusip_pair") == "merged_misfiled"):
                gap.append((d.name, q1, h["cusip"], p.get("cusip_as_filed")))
                slugs.add(d.name)
print(f"probe gap: {len(gap)} lines in {len(slugs)} books matched to a merged prior row with cusip_pair null")
for g in gap[:40]:
    print("  ", g)
print(f"probe rows marked merged_misfiled with filed_cusip == cusip and no cusip_as_filed: {marked_no_filed}")
