#!/usr/bin/env python3
"""Build a conservative, source-linked point-in-time research event registry.
All copy in the game is anonymized; true names and URLs remain in private files.
"""
from __future__ import annotations
import csv
import json
from pathlib import Path
from datetime import date, datetime, timedelta

ROOT = Path(__file__).resolve().parents[1]
EVENTS = [
    ('A-2008-10-31-paper', 'A', '2008-10-31', 'technical_paper',
     'Initial technical paper', 'The early technical proposal describes direct electronic value transfer and transaction validation without a central intermediary.',
     'https://bitcoin.org/en/bitcoin-paper', 'official_original_paper', 'verified_pre_start', 'bitcoin original technical paper; original language'),
    ('B-2014-01-23-intro', 'B', '2014-01-23', 'project_announcement',
     'Programmable contracts introduced', 'Early project documents describe programmable digital contracts and application execution on a distributed network.',
     'https://blog.ethereum.org/2014/01/23/ethereum-now-going-public', 'foundation_dated_post', 'verified_pre_start', 'original historical announcement'),
    ('B-2022-08-24-transition', 'B', '2022-08-24', 'network_announcement',
     'Network transition announced', 'The project announced a planned shift to a different transaction validation mechanism.',
     'https://blog.ethereum.org/2022/08/24/mainnet-merge-announcement', 'foundation_dated_post', 'verified_pre_start', 'an announcement, not a later result'),
    ('B-2023-03-28-upgrade', 'B', '2023-03-28', 'network_announcement',
     'New network feature announced', 'The project published a plan for a network upgrade enabling additional participant withdrawals.',
     'https://blog.ethereum.org/2023/03/28/shapella-mainnet-announcement', 'foundation_dated_post', 'verified_date', 'not visible during 2022 start'),
    ('C-2018-04-18-technology', 'C', '2018-04-18', 'technical_explainer',
     'Core network technique explained', 'The project explained how its network coordinates time and ordering for high-volume transaction processing.',
     'https://solana.com/uk/news/proof-of-history--a-clock-for-blockchain', 'foundation_dated_post', 'verified_pre_start', 'historic article rather than potentially updated PDF'),
    ('C-2022-10-06-incident', 'C', '2022-10-06', 'operational_incident',
     'Network interruption report published', 'A published incident report describes a temporary interruption and subsequent coordinated restart.',
     'https://solana.com/news/09-30-22-solana-mainnet-beta-outage-report', 'foundation_dated_post', 'verified_pre_start', 'known 2022 network incident'),
    ('C-2022-11-17-network', 'C', '2022-11-17', 'network_status',
     'Network condition report published', 'The project released information on network status and resilience following a major market event.',
     'https://solana.com/news/snapshot-state-of-the-network-nov-17-2022', 'foundation_dated_post', 'verified_date', 'NOT visible at 2022-11-07 start'),
    ('D-2022-07-20-software', 'D', '2022-07-20', 'official_software_release',
     'Client software update reported', 'Developer release notes document maintenance, network reliability and security changes.',
     'https://github.com/dogecoin/dogecoin/discussions/3054', 'official_developer_post', 'verified_pre_start', 'not a formal Dogecoin whitepaper'),
    ('E-2022-07-28-q2', 'E', '2022-07-28', 'financial_release',
     'Latest available periodic operating results', 'Quarterly disclosed sales and operating profit data provide a dated view of business activity.',
     'https://news.samsung.com/kr/%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90-2022%EB%85%84-2%EB%B6%84%EA%B8%B0-%EC%8B%A4%EC%A0%81-%EB%B0%9C%ED%91%9C',
     'company_dated_press_release', 'verified_pre_start_candidate', '2022 Q2 sales KRW 77.2T, operating profit KRW 14.1T'),
    ('E-2022-10-27-q3', 'E', '2022-10-27', 'financial_release',
     'Third-quarter results available', 'A new quarterly release reported changes in consolidated sales, business conditions and operating profit.',
     'https://news.samsung.com/kr/%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90-2022%EB%85%84-3%EB%B6%84%EA%B8%B0-%EC%8B%A4%EC%A0%81-%EB%B0%9C%ED%91%9C',
     'company_dated_press_release', 'verified_pre_start_candidate', '2022 Q3 sales KRW 76.78T, operating profit KRW 10.85T'),
    ('E-2023-01-06-guidance', 'E', '2023-01-06', 'earnings_guidance',
     'New earnings guidance released', 'The company published preliminary financial guidance for the prior quarter.',
     'https://news.samsung.com/kr/%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90-2022%EB%85%84-4%EB%B6%84%EA%B8%B0-%EC%9E%A0%EC%A0%95%EC%8B%A4%EC%A0%81-%EB%B0%9C%ED%91%9C',
     'company_dated_press_release', 'verified_date_candidate', 'NOT visible at initial game date'),
    ('E-2023-01-31-q4', 'E', '2023-01-31', 'financial_release',
     'Fourth-quarter results released', 'Actual quarterly financial results and commentary were made public after the simulated start date.',
     'https://news.samsung.com/kr/%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90-2022%EB%85%84-4%EB%B6%84%EA%B8%B0-%EC%8B%A4%EC%A0%81-%EB%B0%9C%ED%91%9C',
     'company_dated_press_release', 'verified_date_candidate', '2022 Q4 sales KRW 70.46T, operating profit KRW 4.31T'),
    ('E-2023-04-27-q1', 'E', '2023-04-27', 'financial_release',
     'Another quarterly report became available', 'The company published new quarterly revenue and earnings figures for that reporting period.',
     'https://news.samsung.com/kr/%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90-2023%EB%85%84-1%EB%B6%84%EA%B8%B0-%EC%8B%A4%EC%A0%81-%EB%B0%9C%ED%91%9C',
     'company_dated_press_release', 'verified_date_candidate', '2023 Q1 sales KRW 63.75T, operating profit KRW 0.64T'),
    ('F-2010-10-14-etf', 'F', '2010-10-14', 'etf_listing_notice',
     'Index tracking fund listing announced', 'A dated listing announcement identified the index-tracking strategy and the intended stock exchange listing.',
     'https://www.newswire.co.kr/newsRead.php?no=502815', 'historical_KRX_press_release', 'verified_pre_start_candidate', 'news release on 2010-10-14; listing planned 2010-10-18'),
    ('G-2019-07-18-reit', 'G', '2019-07-18', 'reit_etf_listing_notice',
     'Listed property investment product announced', 'A contemporaneous news report described a listed fund investing in REITs and infrastructure-related assets.',
     'https://www.newspim.com/news/view/20190718000921', 'dated_listing_report', 'verified_pre_start_candidate', 'article published 2019-07-18; listing scheduled 2019-07-19'),
]
CONFIG = {
  'project':'ERU AI historical investment simulator',
  'game_start_date':'2022-11-07', 'game_end_date':'2026-08-05',
  'start_cash_krw':100000000, 'market_replay_seconds':300,
  'asof_policy':'A dated disclosure becomes playable no earlier than 00:00 KST the calendar day after its publication date when publication hour is unknown. More precise timestamps override this conservative rule.',
  'stock_candidates_pending_confirmation':True,
  'metadata_fetched_at_utc':datetime.utcnow().isoformat()+'Z',
}
MAP = {
 'CASH':{'asset_class':'cash','real_asset':'KRW','selected':True,'market':'KRW'},
 'A':{'asset_class':'crypto','real_asset':'Bitcoin','symbol':'BTC','market':'KRW-BTC','selected':True},
 'B':{'asset_class':'crypto','real_asset':'Ethereum','symbol':'ETH','market':'KRW-ETH','selected':True},
 'C':{'asset_class':'crypto','real_asset':'Solana','symbol':'SOL','market':'KRW-SOL','selected':True},
 'D':{'asset_class':'crypto','real_asset':'Dogecoin','symbol':'DOGE','market':'KRW-DOGE','selected':True},
 'E':{'asset_class':'equity','real_asset':'Samsung Electronics Co., Ltd.','symbol':'005930.KS','exchange_code':'005930','selected':False,'status':'CANDIDATE_ONLY'},
 'F':{'asset_class':'equity_etf','real_asset':'TIGER NASDAQ100 ETF','symbol':'133690.KS','exchange_code':'133690','selected':False,'status':'CANDIDATE_ONLY'},
 'G':{'asset_class':'reit_etf','real_asset':'TIGER REITS REAL ESTATE INFRA ETF','symbol':'329200.KS','exchange_code':'329200','selected':False,'status':'CANDIDATE_ONLY'}
}

payload=[]
for (event_id,alias,pub,kind,title,description,url,source_type,status,notes) in EVENTS:
    availability=(date.fromisoformat(pub)+timedelta(days=1)).isoformat()+'T00:00:00+09:00'
    payload.append(dict(event_id=event_id, asset_alias=alias, published_on=pub,
                        available_at_kst=availability, document_type=kind,
                        public_title=title, public_summary=description,
                        private_source_url=url, source_type=source_type,
                        evidence_status=status, private_notes=notes,
                        source_text_copied=False, full_document_downloaded=False))

(ROOT/'sources'/'source_events.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'config'/'asset_map_PRIVATE.json').write_text(json.dumps(MAP,indent=2,ensure_ascii=False),encoding='utf-8')
(ROOT/'config'/'game.json').write_text(json.dumps(CONFIG,indent=2),encoding='utf-8')
with (ROOT/'sources'/'source_index.csv').open('w',encoding='utf-8-sig',newline='') as f:
    fieldnames=['event_id','asset_alias','published_on','available_at_kst','document_type','public_title','private_source_url','source_type','evidence_status','source_text_copied','full_document_downloaded']
    w=csv.DictWriter(f,fieldnames=fieldnames)
    w.writeheader()
    for ev in payload:w.writerow({k:ev.get(k,'') for k in fieldnames})
print('Created',len(payload),'source-linked dated events')
