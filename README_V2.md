# ERU AI historical investment simulator - research and market data V2

## Exact scope

- Simulator session: **2022-11-07 through 2026-08-05**, initial **KRW 100,000,000**, replay **300 seconds**.
- Cash plus four real-history digital assets masked as **A/B/C/D** and three *unconfirmed candidate* Korean equity/ETF products masked as **E/F/G**.
- After opening the app, players can inspect ONLY research documents that were already publicly available at the game timestamp.
- Each event preserves `published_on`, conservative `available_at_kst`, original URL (INTERNAL ONLY) and anonymized public summary.
- Intraday/weekly/daily market data MUST also be embargoed until the last observation is actually complete.
- AI Risk Guard is built in and is **not configurable by players**. The user can accept, modify or ignore proposed actions.

## Current delivery status

This package has **15 actual, source-linked, historically dated research event records** and runnable downloaders with validation. The research events are linked to source URLs and publication dates verified from official websites and contemporaneous articles; **the underlying PDFs/HTML have not been bulk-downloaded**.

**Important:** Bulk price downloads could not be completed in the current execution environment because external hostname resolution/network access was denied. The price files in `data/normalized/` intentionally remain EMPTY until actually downloaded. Do not treat the UI mock values as true prices.

The event CSV/JSON contains REAL dated events, not generated market candles. Some actual historical financial figures are included in `data/fundamentals/` and are stamped with their 2022/2023 disclosure dates. E/F/G research is explicitly marked as tentative and is SUPPRESSED by the public API until products are confirmed; an internal preview flag exists solely to test candidate reports. The tests use simple synthetic OHLC values privately to test as-of logic; these synthetic values are NEVER written into production price files or the public state snapshots.

## Folders

- `config/asset_map_PRIVATE.json` - true names and real ticker mappings; **never send this to frontend**.
- `config/game.json` - timeline and game rules.
- `sources/source_events.json` - dated research events; original URLs only in this trusted private file.
- `sources/source_index.csv` - human-readable URL and publication date audit.
- `data/fundamentals/` - REAL issuer-reported historical numerical facts and contemporaneous 2010/2019 ETF listing facts for *unconfirmed E/F/G candidates*, with dates and sources. The four dated Samsung quarterly records are not a complete financial history.
- `snapshots/*.json` - anonymized public API-like responses at four representative dates.
- `scripts/collect_upbit.py` - actual Upbit KRW daily OHLCV, page-by-page (with warm-up history).
- `scripts/collect_kr_stocks.py` - candidate KRX tickers through an unofficial experimental Yahoo endpoint.
- `scripts/validate_prices.py` - OHLC/currency/date/gap report; no prices invented.
- `src/asof_engine.py` - source/document and completed-candle as-of gate.
- `tests/test_asof.py` - real release-date visibility, price-candle lookahead and anonymous payload tests.
- `reports/` - network download and QA logs.

## How to populate actual historical prices from a networked PC

### Windows

1. Extract the ZIP into a local folder (e.g. `C:\ERU_AI_Investment_Simulator_V2`).
2. Install Python 3.10+ and connect to the internet.
3. Double-click `scripts\RUN_WINDOWS.bat`.
4. Confirm reports, row counts, SHA256 and first/last dates before using data. A script finishing without exceptions does not prove all market days are present.

### macOS / Linux / Terminal

```sh
cd ERU_AI_Investment_Simulator_V2
python scripts/collect_upbit.py
python scripts/collect_kr_stocks.py
python scripts/validate_prices.py
python -m unittest discover -s tests -v
python scripts/create_snapshots.py
```

## Data timing and no-lookahead rules

- **Upbit:** UTC-day candle opens at 00:00 UTC (09:00 KST). It is complete only at **09:00 KST the next calendar day**. Treat OHLC and volume as unavailable until then.
- **KRX:** historical daily observations become available only after the local market close. The experimental collector uses a conservative 15:40 KST timestamp and must be replaced by a licensed historical source for production.
- **Research:** for dated public announcements without a reliable exact timestamp, `available_at_kst` is **00:00 KST on the day following the dated publication** (intentionally conservative).
- **Game screenshots and data access:** only `public_research()` and `public_market()` results are exposed. `private_source_url`, true ticker mapping and futures dates/counts stay on the server.
- **Initial portfolio:** do not fill at the same daily close that has already been used to generate the trade signal. `next_execution_candle()` describes a simple conservative next-open proxy; production needs a synchronized exchange-specific fill model and slippage/fees.
- **Weekly indicators:** compute from completed daily data only. Never inspect full current-week high, low or close before the week ends. The downloader requests 224 pre-start warm-up days; the UI still starts on 2022-11-07.
- **Assets E/F/G:** current names and tickers in `asset_map_PRIVATE.json` are **candidates**. Before finalizing, verify 2022 listing, historical pricing, splits, ETF NAV, dividend/distribution history, point-in-time composition, licensing and currency treatment.
- **End timestamp:** the UI date is 2026-08-05; an Upbit UTC session labelled that date does not close until 2026-08-06 09:00 KST. The end-of-day settlement cannot be shown at any earlier game timestamp. Align the game clock or request earlier completed observations.

## Licensing warning: do not publish market data yet

Upbit Open API terms reserve ownership of API content and expressly restrict unauthorized reproduction, processing, redistribution and commercial exploitation. KRX security prices and fund factsheets can also have licensing restrictions. The historical candles downloader is an internal evaluation utility ONLY; before making the game public, secure an appropriate licensed data source/contract and check document reuse permissions. See https://docs.upbit.com/kr/changelog/open_api_agreement_revision and https://docs.upbit.com/kr/reference/list-candles-days .

The screenshot/design examples are not real asset performance and not a return prediction.

## What remains to launch

1. Download and verify **1,368 game-date candles per crypto asset** (plus 224 warm-up days), capture complete manifests and missing dates. Test market opening availability for each pair.
2. Obtain licensed KRX historical OHLCV for selected E/F/G and trustworthy corporate actions/distributions; do not treat unofficial quotes as certified.
3. Obtain copyright-compliant archival snapshots of historic whitepapers/release documents and per-period issuer filings; do not redistribute full copyrighted third-party documents without permission.
4. Connect the API and UI to `asof_engine.py` (or port these rules to the chosen backend). The Figma screens are interface design and do not have a live data backend.
5. Review licensing for commercial publication, resampling and caching.

## Source material caveat

Links to source materials are provided for verification in `sources/source_index.csv`. Some original project pages are updated over time; when past versions cannot be verified, retain them as prospective sources only rather than showing later revisions as if they were known in 2022.
