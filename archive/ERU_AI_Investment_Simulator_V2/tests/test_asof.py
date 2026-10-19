import unittest
from datetime import datetime
from src.asof_engine import (
 load_event_registry,public_research,public_market,next_execution_candle,
 assemble_public_state,validate_no_identifiers,parse_instant)

class HistoricalVisibilityTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.events=load_event_registry()
 def test_start_date_hides_future_reports(self):
  records=public_research(self.events,'2022-11-07T23:59:59+09:00',allow_candidate_previews=True)
  ids={x['event_id'] for x in records}
  self.assertIn('E-2022-10-27-q3',ids)
  self.assertIn('C-2022-10-06-incident',ids)
  self.assertNotIn('C-2022-11-17-network',ids)
  self.assertNotIn('E-2023-01-31-q4',ids)
  self.assertNotIn('B-2023-03-28-upgrade',ids)
 def test_new_source_unlocks_only_after_conservative_publication_day(self):
  self.assertNotIn('C-2022-11-17-network',{x['event_id'] for x in public_research(self.events,'2022-11-17T23:59:59+09:00')})
  self.assertIn('C-2022-11-17-network',{x['event_id'] for x in public_research(self.events,'2022-11-18T00:00:00+09:00')})
 def test_company_next_report_hidden_before_publication(self):
  self.assertNotIn('E-2023-01-31-q4',{x['event_id'] for x in public_research(self.events,'2023-01-31T23:59:59+09:00',allow_candidate_previews=True)})
  self.assertIn('E-2023-01-31-q4',{x['event_id'] for x in public_research(self.events,'2023-02-01T00:00:00+09:00',allow_candidate_previews=True)})
 def test_unconfirmed_asset_research_is_not_published(self):
  self.assertEqual(public_research(self.events,'2026-08-05T23:59:59+09:00','E'),[])
  self.assertGreater(len(public_research(self.events,'2026-08-05T23:59:59+09:00','E',allow_candidate_previews=True)),0)
 def test_public_docs_have_no_real_assets_or_links(self):
  for d in ['2022-11-07T23:59:59+09:00','2022-11-18T23:59:59+09:00','2023-02-01T23:59:59+09:00','2026-08-05T23:59:59+09:00']:
   for a in 'ABCDEFG':
    p=assemble_public_state(self.events,[],d,a)
    self.assertTrue(validate_no_identifiers(p))
    self.assertNotIn('private_source_url',str(p))
 def test_private_future_count_not_sent(self):
  f=assemble_public_state(self.events,[],'2022-11-07T23:59:59+09:00','E')
  self.assertNotIn('locked_future_count',f)
  self.assertNotIn('future_events',f)
 def test_no_unfinished_upbit_candle(self):
  candles=[
   {'asset_alias':'A','session_date':'2022-11-06','price_available_at_kst':'2022-11-07T09:00:00+09:00','open':10,'high':20,'low':8,'close':19,'volume':10},
   {'asset_alias':'A','session_date':'2022-11-07','price_available_at_kst':'2022-11-08T09:00:00+09:00','open':19,'high':35,'low':17,'close':31,'volume':15},
   {'asset_alias':'A','session_date':'2022-11-08','price_available_at_kst':'2022-11-09T09:00:00+09:00','open':31,'high':41,'low':29,'close':39,'volume':16}
  ]
  seen=public_market(candles,'2022-11-07T23:59:59+09:00','A')
  self.assertEqual([x['session_date'] for x in seen],['2022-11-06'])
  seen=public_market(candles,'2022-11-08T09:00:00+09:00','A')
  self.assertEqual([x['session_date'] for x in seen],['2022-11-06','2022-11-07'])
 def test_order_executes_next_open(self):
  mock=[{'session_date':'2022-11-07','open':19},{'session_date':'2022-11-08','open':31},{'session_date':'2022-11-09','open':40}]
  self.assertEqual(next_execution_candle(mock,'2022-11-07T23:59:59+09:00')['open'],31)
 def test_naive_timestamp_rejected(self):
  with self.assertRaises(ValueError):parse_instant(datetime(2022,11,7,23,59,59))

if __name__=='__main__':unittest.main()

class ActualFinancialDisclosureTests(unittest.TestCase):
 def test_released_financial_data_only(self):
  from pathlib import Path
  from src.asof_engine import read_candles,public_fundamentals
  path=Path(__file__).resolve().parents[1]/'data'/'fundamentals'/'E_candidate_historical_releases_PRIVATE.csv'
  rows=read_candles(path)
  self.assertEqual(len(public_fundamentals(rows,'2022-11-07T23:59:59+09:00')),0)
  at_start=public_fundamentals(rows,'2022-11-07T23:59:59+09:00',allow_candidate_previews=True)
  self.assertEqual(set(r['period'] for r in at_start),{'2022-Q2','2022-Q3'})
  self.assertNotIn('2022-Q4',{r['period'] for r in at_start})
  prior=public_fundamentals(rows,'2023-01-31T23:59:59+09:00',allow_candidate_previews=True)
  self.assertNotIn('2022-Q4',{r['period'] for r in prior})
  after=public_fundamentals(rows,'2023-02-01T00:00:00+09:00',allow_candidate_previews=True)
  self.assertIn('2022-Q4',{r['period'] for r in after})
  self.assertTrue(all('source' not in str(row) and 'Samsung' not in str(row) for row in after))
