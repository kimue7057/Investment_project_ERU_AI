#!/usr/bin/env python3
"""Persist a narrow set of verified historical figures from dated issuer posts.

Not a full archive, not an exhaustive representation of issuer filings.
All E/F/G rows remain internal until their asset selections are approved.
"""
from pathlib import Path
import csv
ROOT=Path(__file__).resolve().parents[1]
RESULTS=[
 {'alias':'E','candidate_name_private':'Samsung Electronics','period':'2022-Q2','published_on':'2022-07-28','available_at_kst':'2022-07-29T00:00:00+09:00','sales_krw_trillion':77.2,'operating_profit_krw_trillion':14.1,'verified_source':'https://news.samsung.com/kr/%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90-2022%EB%85%84-2%EB%B6%84%EA%B8%B0-%EC%8B%A4%EC%A0%81-%EB%B0%9C%ED%91%9C','release_type':'actual'},
 {'alias':'E','candidate_name_private':'Samsung Electronics','period':'2022-Q3','published_on':'2022-10-27','available_at_kst':'2022-10-28T00:00:00+09:00','sales_krw_trillion':76.78,'operating_profit_krw_trillion':10.85,'verified_source':'https://news.samsung.com/kr/%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90-2022%EB%85%84-3%EB%B6%84%EA%B8%B0-%EC%8B%A4%EC%A0%81-%EB%B0%9C%ED%91%9C','release_type':'actual'},
 {'alias':'E','candidate_name_private':'Samsung Electronics','period':'2022-Q4','published_on':'2023-01-31','available_at_kst':'2023-02-01T00:00:00+09:00','sales_krw_trillion':70.46,'operating_profit_krw_trillion':4.31,'verified_source':'https://news.samsung.com/kr/%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90-2022%EB%85%84-4%EB%B6%84%EA%B8%B0-%EC%8B%A4%EC%A0%81-%EB%B0%9C%ED%91%9C','release_type':'actual'},
 {'alias':'E','candidate_name_private':'Samsung Electronics','period':'2023-Q1','published_on':'2023-04-27','available_at_kst':'2023-04-28T00:00:00+09:00','sales_krw_trillion':63.75,'operating_profit_krw_trillion':0.64,'verified_source':'https://news.samsung.com/kr/%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90-2023%EB%85%84-1%EB%B6%84%EA%B8%B0-%EC%8B%A4%EC%A0%81-%EB%B0%9C%ED%91%9C','release_type':'actual'}
]
ETF=[
 {'alias':'F','private_ticker':'133690','candidate_name_private':'TIGER NASDAQ100','listing_date':'2010-10-18','notice_date':'2010-10-14','available_at_kst':'2010-10-15T00:00:00+09:00','tracking_index':'NASDAQ-100','evidence_url':'https://www.newswire.co.kr/newsRead.php?no=502815','status':'CANDIDATE_NOT_CONFIRMED'},
 {'alias':'G','private_ticker':'329200','candidate_name_private':'TIGER REITS REAL ESTATE INFRA','listing_date':'2019-07-19','notice_date':'2019-07-18','available_at_kst':'2019-07-19T00:00:00+09:00','tracking_index':'historical REIT and real estate infrastructure strategy; live index methodology may differ','evidence_url':'https://www.newspim.com/news/view/20190718000921','status':'CANDIDATE_NOT_CONFIRMED'}
]
def save(name,data):
 p=ROOT/'data'/'fundamentals'/name
 with p.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(data[0]));w.writeheader();w.writerows(data)
 return str(p),len(data)
print(save('E_candidate_historical_releases_PRIVATE.csv',RESULTS))
print(save('FG_candidate_listing_facts_PRIVATE.csv',ETF))
