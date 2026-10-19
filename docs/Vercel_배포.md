# Vercel 온라인 Alpha 배포 · 2026-10-19

## 접속 및 연결

- 체험 주소: https://eru-ai-investment-simulator.vercel.app
- 상태 확인: https://eru-ai-investment-simulator.vercel.app/api/health
- 프로젝트: https://vercel.com/eruty1/eru-ai-investment-simulator
- GitHub: https://github.com/kimue7057/Investment_project_ERU_AI
- 연결 브랜치: main. 저장소 변경을 푸시하면 Vercel에서 다시 빌드합니다.
- 계정 플랜: 기존 eruty Hobby. 유료 플랜으로 변경하지 않았습니다.

시작 화면과 health/catalog API에 인증 없이 HTTP 200으로 접속되는 것을 확인했습니다. health는 실제 데이터 및 비공개 저장소 준비 상태가 충족될 때 ready를 반환합니다. Vercel의 개별 Preview 주소에는 계정 인증 보호가 적용될 수 있으므로 외부 공유에는 위의 정식 체험 주소를 사용하세요.

## 배포 구조

기존 React/Vite와 Python/FastAPI 엔진을 유지합니다. index.py가 Python 진입점이며 pyproject.toml이 Python 3.12와 서버 의존성을 지정합니다. vercel.json은 프론트엔드 빌드, 데이터 포함 및 서울 리전(icn1)을 설정합니다. 정적 프론트엔드는 CDN에서, /api는 Python Function에서 제공합니다.

Vercel 함수의 임시 파일시스템을 게임 저장소로 쓰지 않습니다. 온라인 모드에서는 서울 리전의 **비공개 Vercel Blob**에 세션을 저장하고, 로컬 실행은 기존 SQLite를 유지합니다. [Vercel의 SQLite 설명](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)

상태 읽기는 원본 저장소에서 최신 버전을 조회합니다. 수정 시 ETag 조건부 쓰기로 다른 요청의 변경을 덮어쓰지 않으며 충돌한 요청은 최신 상태에서 다시 처리합니다. 일반 재생 프레임은 저장된 기준점에서 서버 시각으로 재구성하고, 매매·정지·종료 및 5초 체크포인트를 저장해 조회 간 쓰기 경합과 사용량을 줄입니다. 브라우저는 게임 날짜·잔고·체결가를 임의로 지정할 수 없습니다.

서로 다른 함수 인스턴스도 같은 게임을 이어갈 수 있도록 기준 시각을 저장합니다. 마지막 저장 후 15초 이상 활성 요청이 없으면 장기 백그라운드/연결 중단으로 보고 일시정지합니다. 일시정지 중의 판단 시간은 계속 300초에서 제외합니다. 세션 주소를 알면 해당 게임에 접근할 수 있으므로 UUID는 공유용 플레이 주소와 구분하세요.

## 실제 시세 및 비밀정보

검증된 코인 4종 CSV를 market/alpha-v1.zip으로 압축해 프로젝트의 비공개 Blob 저장소에 업로드했습니다. ZIP에는 CSV 4개만 있으며 원본 페이지나 세션 DB를 넣지 않습니다. 시세 CSV는 계속 Git에서 제외됩니다.

빌드 시 서버 자격증명으로만 ZIP을 가져오고, Git에 기록한 SHA256와 대조한 뒤 날짜 연속성·OHLCV·통화·공개 시각을 재검증합니다. 실패하면 배포 빌드가 실패합니다. 시세는 Python 함수 번들에만 포함되고 정적 마운트는 frontend/dist만 제공합니다. 게임 종료 전에는 기존의 서버 공개 경계가 현재까지의 시세와 익명 자료만 반환합니다.

BLOB_READ_WRITE_TOKEN은 Vercel 환경변수에 있습니다. 로컬 .env.local과 .vercel은 Git 및 업로드에서 제외합니다. 토큰과 비공개 ZIP 주소를 브라우저 응답이나 README에 공개하지 않습니다. Preview와 Production 세션은 별도 경로로 분리합니다.

## 다시 배포하기

일반 코드 변경은 검증 후 main에 푸시합니다. 수동 배포는 프로젝트 폴더에서 `vercel deploy --prod --scope eruty1`을 실행합니다. Vercel CLI는 이 PC의 로그인 정보를 사용합니다.

실제 시세를 갱신할 때는 먼저 로컬 수집·검증을 완료하고 변경된 manifest를 검토합니다. `vercel env pull .env.local --environment production`으로 프로젝트 환경변수를 로컬에 받은 뒤 `scripts/upload_cloud_data.py`를 실행하면 검증된 CSV만 비공개 ZIP으로 올립니다. 이 보조 스크립트는 python-dotenv가 필요합니다. 갱신된 manifest와 코드만 Git에 반영하고 원본·CSV·자격증명은 커밋하지 않습니다.

```powershell
$env:ERU_BASE_URL='https://eru-ai-investment-simulator.vercel.app'
node scripts/browser_smoke.cjs
```

Hobby 사용량 한도와 비공개 저장소의 읽기·쓰기 한도가 적용됩니다. 현재는 검토 규모의 Alpha 구성이며 대규모 사용자 운영 전에는 데이터 이용권한, 요청 제한, 세션 보존기간 및 전용 데이터베이스 전환을 검토해야 합니다. 시세·기술문서의 상업 이용 및 재배포 권한은 별도 확정 사항입니다.
