# Vercel 온라인 Alpha 배포 · 2026-10-19

## 2026-10-21 저장소 전환

사용자가 지정한 KIMUE_PRIVATE의 기존 `Debate project`를 `eru-ai-investment-simulator`로 변경해 재사용한다. 새 유료 프로젝트를 생성하지 않았다. 기존 토론 테이블 4개·함수 2개와 관리자 계정은 Git에서 제외한 로컬 백업을 저장한 후 정리했다. Supabase 관리 스키마는 유지한다.

운영 환경은 `ERU_STORAGE_BACKEND=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 사용한다. Secret key는 Vercel Production의 Secret으로만 등록한다. 키를 로컬로 내려받거나 Git·브라우저에 포함하지 않는다. 로컬 기본 실행은 SQLite다.

전용 테이블은 `eru_game_sessions`, `eru_market_bundles`다. 두 테이블 모두 RLS를 켜고 anon/authenticated 권한을 제거해 서버만 접근한다. 세션은 environment와 UUID로 구분하고 revision 비교를 포함한 원자적 UPDATE로 수정 충돌을 처리한다. 예전 Blob 세션은 정지된 저장소에 보존하며, 접근이 복구되기 전에는 이관됐다고 보지 않는다. 브라우저에서 찾지 못한 이전 게임 ID는 별도 키에 남기고 새 게임을 생성한다.

시세 빌드 원본도 Supabase의 비공개 테이블에 보관한다. 최초 이전 배포는 로컬의 검증된 CSV 4개만 비공개 배포 소스로 포함해 압축 원본을 저장한다. 이후 빌드는 DB에서 읽는다. ZIP 체크섬과 Git에서 관리하는 자산별 CSV SHA256를 모두 검사하며, 불일치 시 로컬 CSV나 Blob으로 우회하지 않고 빌드를 중단한다. CSV는 Git과 정적 프론트엔드에 포함하지 않는다. 최초 배포 이후 `.vercelignore`의 `data/normalized` 제외를 복구한다.

준비·정지·종료 화면은 반복 조회하지 않고 실행 중에만 순차 조회한다. 3회 연속 오류 후 자동 조회를 중단하고 수동 재연결을 제공한다. health는 실제 저장소 읽기를 확인하고 실패하면 503을 반환한다. 상세 상태와 검증 기록은 [저장소 연결 장애 기록](저장소_연결장애_2026-10-21.md)을 참조한다. 아래 2026-10-19 Blob 구성과 테스트 결과는 초기 배포 기록이다.

## 접속 및 연결

- 체험 주소: https://eru-ai-investment-simulator.vercel.app
- 상태 확인: https://eru-ai-investment-simulator.vercel.app/api/health
- 프로젝트: https://vercel.com/eruty1/eru-ai-investment-simulator
- GitHub: https://github.com/kimue7057/Investment_project_ERU_AI
- 연결 브랜치: main. 저장소 변경을 푸시하면 Vercel에서 다시 빌드합니다.
- 계정 플랜: 기존 eruty Hobby. 유료 플랜으로 변경하지 않았습니다.

시작 화면과 health/catalog API에 인증 없이 HTTP 200으로 접속되는 것을 확인했습니다. health는 실제 데이터 및 비공개 저장소 준비 상태가 충족될 때 ready를 반환합니다. Vercel의 개별 Preview 주소에는 계정 인증 보호가 적용될 수 있으므로 외부 공유에는 위의 정식 체험 주소를 사용하세요.

## 초기 배포 구조 (2026-10-19 기록)

기존 React/Vite와 Python/FastAPI 엔진을 유지합니다. index.py가 Python 진입점이며 pyproject.toml이 Python 3.12와 서버 의존성을 지정합니다. vercel.json은 프론트엔드 빌드, 데이터 포함 및 서울 리전(icn1)을 설정합니다. 정적 프론트엔드는 CDN에서, /api는 Python Function에서 제공합니다.

Vercel 함수의 임시 파일시스템을 게임 저장소로 쓰지 않습니다. 온라인 모드에서는 서울 리전의 **비공개 Vercel Blob**에 세션을 저장하고, 로컬 실행은 기존 SQLite를 유지합니다. [Vercel의 SQLite 설명](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)

상태 읽기는 원본 저장소에서 최신 버전을 조회합니다. 수정 시 ETag 조건부 쓰기로 다른 요청의 변경을 덮어쓰지 않으며 충돌한 요청은 최신 상태에서 다시 처리합니다. 일반 재생 프레임은 저장된 기준점에서 서버 시각으로 재구성하고, 매매·정지·종료 및 5초 체크포인트를 저장해 조회 간 쓰기 경합과 사용량을 줄입니다. 브라우저는 게임 날짜·잔고·체결가를 임의로 지정할 수 없습니다.

서로 다른 함수 인스턴스도 같은 게임을 이어갈 수 있도록 기준 시각을 저장합니다. 마지막 저장 후 15초 이상 활성 요청이 없으면 장기 백그라운드/연결 중단으로 보고 일시정지합니다. 일시정지 중의 판단 시간은 계속 300초에서 제외합니다. 세션 주소를 알면 해당 게임에 접근할 수 있으므로 UUID는 공유용 플레이 주소와 구분하세요.

## 실제 시세 및 비밀정보

검증된 코인 4종 CSV를 market/alpha-v1.zip으로 압축해 프로젝트의 비공개 Blob 저장소에 업로드했습니다. ZIP에는 CSV 4개만 있으며 원본 페이지나 세션 DB를 넣지 않습니다. 시세 CSV는 계속 Git에서 제외됩니다.

빌드 시 서버 자격증명으로만 ZIP을 가져오고, Git에 기록한 SHA256와 대조한 뒤 날짜 연속성·OHLCV·통화·공개 시각을 재검증합니다. 실패하면 배포 빌드가 실패합니다. 시세는 Python 함수 번들에만 포함되고 정적 마운트는 frontend/dist만 제공합니다. 게임 종료 전에는 기존의 서버 공개 경계가 현재까지의 시세와 익명 자료만 반환합니다.

BLOB_READ_WRITE_TOKEN은 Vercel 환경변수에 있습니다. 로컬 .env.local과 .vercel은 Git 및 업로드에서 제외합니다. 토큰과 비공개 ZIP 주소를 브라우저 응답이나 README에 공개하지 않습니다. Preview와 Production 세션은 별도 경로로 분리합니다.

## 실제 온라인 검증 결과

- 백엔드 회귀 테스트 31개, 프론트엔드 테스트 2개와 타입 검사·빌드 통과.
- 정식 공유 주소에서 시작·자료 탐색·초기 배분·수동 매수·리밸런싱·일시정지·모바일 화면 확인.
- 활성 시장 재생 **300초** 완료. 최종 거래 11건, 결과 화면과 종료 후 실제 자산명 공개 확인.
- 재도전 시 새 세션, 현금 1억 원, 재생 0초, 거래 내역 초기화 확인.
- 비공개 CSV·자료 원본 목록·.env.local 직접 요청은 404. 공개 응답의 미래 캔들·식별자 검사를 통과.
- GitHub main 푸시로 새 Production 배포가 생성되고 성공하는 것을 확인.

첫 온라인 전체 테스트는 알림 대기와 통신 시간을 포함한 도구의 7분 제한에 걸렸습니다. 당시 활성 재생은 249.080초였고, 같은 게임을 새 브라우저에서 복원해 남은 구간을 진행했습니다. 추가 약 59.614초의 실제 시간 후 활성 재생 300초에 도달했고 결과·재도전 검증을 통과했습니다. 온라인 테스트 제한은 이러한 대기 시간을 고려해 15분으로 늘렸습니다. 게임 진행 기록을 버리거나 시장 날짜를 강제로 이동하지 않았습니다.

관측된 테스트 결과는 최종 자산 219,419,090.51원, 수익률 +119.4191%, 일별 최대 낙폭 66.8361%입니다. 특정 테스트 조작의 결과이며 추천 전략이나 고정된 예시 수익률이 아닙니다. 원시 보고와 화면은 Git에서 제외한 test-results/cloud-browser-report.json 및 cloud-08-result.png, cloud-09-reveal.png에 있습니다. 복원 검증 도구는 scripts/cloud_resume_smoke.cjs이며 실제 테스트 실행에서 기록한 세션 파일만 사용합니다.

저장 상태가 커지면 CDN이 응답 ETag를 약한 형식으로 바꾸던 문제를 수정하고 실제 비공개 저장소로 재검증했습니다. 원본 읽기와 조건부 쓰기에 대한 회귀 테스트를 추가했으며 오류 로그에는 자격증명이나 비공개 URL을 기록하지 않습니다.

## 초기 Blob 배포 절차 (현재 운영에 사용하지 않음)

일반 코드 변경은 검증 후 main에 푸시합니다. 수동 배포는 프로젝트 폴더에서 `vercel deploy --prod --scope eruty1`을 실행합니다. Vercel CLI는 이 PC의 로그인 정보를 사용합니다.

실제 시세를 갱신할 때는 먼저 로컬 수집·검증을 완료하고 변경된 manifest를 검토합니다. `vercel env pull .env.local --environment production`으로 프로젝트 환경변수를 로컬에 받은 뒤 `scripts/upload_cloud_data.py`를 실행하면 검증된 CSV만 비공개 ZIP으로 올립니다. 이 보조 스크립트는 python-dotenv가 필요합니다. 갱신된 manifest와 코드만 Git에 반영하고 원본·CSV·자격증명은 커밋하지 않습니다.

```powershell
$env:ERU_BASE_URL='https://eru-ai-investment-simulator.vercel.app'
node scripts/browser_smoke.cjs
```

Hobby 사용량 한도와 비공개 저장소의 읽기·쓰기 한도가 적용됩니다. 현재는 검토 규모의 Alpha 구성이며 대규모 사용자 운영 전에는 데이터 이용권한, 요청 제한, 세션 보존기간 및 전용 데이터베이스 전환을 검토해야 합니다. 시세·기술문서의 상업 이용 및 재배포 권한은 별도 확정 사항입니다.
