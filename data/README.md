# Spot dataset

`spots.json` is the curated list of kiteboarding spots bundled with gust. It has
687 spots worldwide, 320 of them in the US, across 75 countries. The app merges these with OpenStreetMap
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
  "sectors": [[260, 340]],
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
   - Crissy Field: W to NNW (SW blows off the Presidio shore).
   - Kanaha: NE trades, side-on.
   - Tarifa: Levante (E) and Poniente (W).
5. Some famous flat-water spots are usually ridden side-off over waist-deep water
   with a rescue service, such as Laguna Madre (South Padre, Bird Island Basin), Aruba
   (Hadicurari), Bonaire (Atlantis) and Cape Verde (Ponta Preta). gust stays
   conservative here. The sector covers only the side-shore directions, and the notes
   say that the usual trade-wind direction gets rated offshore.
6. Hard limit: no rideable direction may be more than about 100° from the seaward
   normal. `tests/dataset-safety.test.ts` checks the known side-off cases and fails if any spot
   other than a documented `[0, 360]` entry has more than 220° of rideable sector in total.

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
  `diamond-head`, `spi-kite-beach`, `bird-island-basin`, `cabo-de-la-vela`,
  `cape-verde-ponta-preta`): sectors were cut back to side-shore only, so the
  directions locals usually ride are rated offshore on purpose.
- **Orientation estimated from memory, narrowed on safety grounds** (`rio-vista`,
  `cabrillo-beach`, `candlestick-point`, `tiana-beach`, `napeague-lazy-point`,
  `third-beach`, `lake-pepin-lake-city`, `peru-paracas`, `buen-hombre`,
  `lagoa-da-conceicao`, `tarifa-los-lances`, `bolonia`): the launch shore's facing
  was estimated without imagery. Check these against satellite imagery before you widen them.
- **Approximate coordinates** (`kona-old-airport`, `turnagain-arm-hope`,
  `exmouth-town-beach`, `abu-dhabi-kite-beach`, `limnos-keros`, `china-pingtan`,
  `buen-hombre`, `salinas-del-rey`, `djerba`, `india-*`, `pagudpud`,
  `nantucket-madaket`, `monomoy`): positions are approximate.
- **Inland lakes and reservoirs** (UT, CO, NV, MN): wind sectors are generalised.
  Water levels and shorelines change with the season.

## Approximate positions

Some positions come from a town or kite-school location rather than the waterline and may be a
few hundred metres off: `chicxulub`, `hurghada-north`, `wadi-lahami`, `sint-joris`, `kawama`,
`umm-al-quwain`, `theologos`, `grapevine-lake`, `galveston-8-mile-road`, and entries whose notes
say "Approximate position". `node scripts/check-spots.mjs` flags coastal spots that sit well above
sea level (Open-Meteo elevation, per-IP rate limits apply).
