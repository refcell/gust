# Spot dataset

`spots.json` is the curated list of kiteboarding spots bundled with gust. It has
418 spots worldwide, 185 of them in the US. The app merges these with OpenStreetMap
`sport=kitesurfing` results at runtime.

## Schema

The file is a JSON array. Each entry looks like this:

```json
{
  "id": "crissy-field",
  "name": "Crissy Field (East Beach)",
  "lat": 37.8056,
  "lon": -122.4598,
  "country": "US",
  "region": "CA",
  "sectors": [[200, 320]],
  "water": "chop",
  "level": "advanced",
  "notes": "Apr-Sep W thermal; strong ebb currents, shipping lane, cold water. Launch East Beach, experts only."
}
```

| field     | type                  | notes |
|-----------|-----------------------|-------|
| `id`      | string                | Unique kebab-case slug. Never change an existing id: saved spots and alert state use it. |
| `name`    | string                | Common local name, plus the area in parentheses when the name alone is ambiguous. |
| `lat`     | number                | WGS84 decimal degrees, at most 5 decimals (about 1 m). Use the launch point at the waterline. |
| `lon`     | number                | WGS84 decimal degrees, at most 5 decimals. West is negative, so all of the Americas are negative. |
| `country` | string                | ISO 3166-1 alpha-2 code (`US`, `ES`, `BR`, ...). |
| `region`  | string, optional      | State or province code (`CA`, `HI`, `BC`, `QLD`, ...). Leave it out when not useful. |
| `sectors` | `[from, to][]`        | Wind directions that are safe to ride. See below. |
| `water`   | enum                  | `flat`, `chop`, `waves` or `mixed`. |
| `level`   | enum                  | `beginner`, `intermediate`, `advanced` or `all`. |
| `notes`   | string, ≤ 140 chars   | Best season and wind, hazards, launch or access info. Facts only. |

## Sector convention

- Directions are meteorological: the compass bearing the wind **comes from**,
  in degrees (0/360 = N, 90 = E, 180 = S, 270 = W).
- Each sector `[from, to]` runs **clockwise** from `from` to `to`, and includes both ends.
- A sector may wrap past north. `[300, 30]` means 300° → 360° → 30°.
- A spot can have more than one sector, for example Tarifa's Levante and Poniente:
  `[[60, 120], [240, 300]]`.
- `[0, 360]` means every direction. Only use it where you can launch from more than
  one shore and pick the side that is onshore, such as causeways, sandbars or lagoons
  with launches all around. The notes must say so.
- Sectors include only onshore, side-onshore and side-shore directions. They
  **never include offshore**, because offshore wind is unsafe and must never score as good.

How sectors were derived:

1. Find the seaward normal of the beach: the compass bearing pointing straight out
   to sea from the launch.
2. Wind from that bearing is onshore. Side-shore is that bearing ±90°.
3. The default rideable sector is roughly normal ±95°, which keeps everything
   between side-shore and side-shore through onshore.
4. Narrow it using local knowledge: channelled winds (rivers, straits, lakes in
   valleys), known seasonal directions, and directions known to be dangerous or
   blocked. Examples:
   - Hood River: W and E along the Columbia Gorge.
   - Crissy Field: SW to NW.
   - Kanaha: NE trades, side-on.
   - Tarifa: Levante (E) and Poniente (W).
5. Some famous flat-water spots are ridden side-shore or slightly side-off over
   waist-deep water, such as Laguna Madre (South Padre, Bird Island Basin), SF Bay
   peninsula spots and Aruba. For these, the sector covers only the commonly
   ridden side-shore directions, and the notes flag the risk.

## Sources

Entries were compiled by hand from general geographic knowledge of each coastline:
shoreline orientation from maps and satellite imagery, plus widely published local
wind patterns (seasonal trades, thermals, monsoons, gorge and strait winds).
Coordinates are approximate launch points, not surveyed positions. Nothing was
copied from a proprietary spot database.

## Contributing

- Add or fix entries with a PR. Keep the file as one JSON object per line, so diffs
  stay readable.
- Give coordinates for where riders actually rig and launch, at the waterline, with
  at most 5 decimals. Check them on satellite imagery.
- Work out sectors with the method above, and leave out anything offshore. If you
  are not sure, use a narrower sector.
- Keep notes short and factual: season, wind, hazards, access, local rules. No
  marketing copy.
- Never rename or reuse an `id`.
- Before opening a PR, check that the JSON parses, ids are unique, coordinates are
  in range, sector values are within 0–360, and `water` and `level` use the
  allowed values.

## Known lower-confidence entries

The coordinates or sectors of these entries need verifying on the ground. Fixes
are welcome:

- **SF Bay peninsula** (`third-ave-foster-city`, `coyote-point`, `palo-alto-baylands`):
  exact launch positions and which W/NW directions count as side-shore.
- **Side-off flat-water spots** (`aruba-hadicurari`, `bonaire-atlantis`,
  `diamond-head`, `spi-kite-beach`, `bird-island-basin`): sectors cover the commonly
  ridden directions, which are side-shore to side-off.
- **Approximate coordinates** (`kona-old-airport`, `turnagain-arm-hope`,
  `exmouth-town-beach`, `abu-dhabi-kite-beach`, `limnos-keros`, `china-pingtan`,
  `buen-hombre`, `salinas-del-rey`, `djerba`, `india-*`, `pagudpud`,
  `nantucket-madaket`, `monomoy`): positions are approximate.
- **Inland lakes and reservoirs** (UT, CO, NV, MN): wind sectors are generalised.
  Water levels and shorelines change with the season.
