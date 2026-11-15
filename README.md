# ERU AI · 비트코인 리스크 가드

[운영 앱 열기](https://eru-ai-investment-simulator.vercel.app)

**스플래시 → 인증 없이 투자금 입력 → 비트코인 세 사이클 자동 비교 → 자산·낙폭 결과 → 대응 복기**를 제공하는 모의 시뮬레이터입니다.

모바일은 고정 하단 탭과 화면별 주요 버튼, 가로로 넘기는 복기 장면으로 구성합니다. 기본 언어는 영어이며 **Settings → 한국어** 또는 상단 **EN** 버튼에서 전환합니다. 언어 선택은 이 기기에 저장되고 기존 비교·기록은 유지됩니다. 영어 화면의 금액도 원화(₩)이며 달러 환산이 아닙니다.

- 두 계좌 모두 같은 자금으로 비트코인 100%에서 출발합니다. 단순 보유와 가드의 분할 매도·대기·재매수를 비교합니다.
- 기간은 2016.07~2020.04, 2020.05~2023.06, 2023.07~2026.05이며 각 구간은 독립적으로 시작합니다. 기본 입력 자금 1억 원, 총 기본 재생 300초, 배속과 결과 바로 보기를 지원합니다.
- Coinbase Exchange의 공식 BTC-USD 일봉 3,683개를 검증했습니다. 엑셀의 규칙을 서버의 Decimal 장부로 재계산하며, 판단 이후 다음 일봉 시가에 체결합니다.
- 원화 자본에 USD 가격 변동률을 적용한 비교입니다. 수수료 0.05%를 반영하며 환율 변동·현금 이자·슬리피지는 미반영합니다.
- 낙폭이 줄어도 최종 자산이 단순 보유보다 적을 수 있습니다. 최대 낙폭과 종료 손익을 함께 표시하며, 혼합 포트폴리오 리플렛의 수치를 BTC 단독 성과로 사용하지 않습니다.
- 기록은 이 브라우저의 방문자 쿠키로 구분해 서버에 보관합니다. 다른 기기에 자동 연결되지 않습니다. 진행 중 미래 시세와 대응을 공개하지 않습니다.

## 결과 메일

결과 화면의 이메일 요청, 서버 보고서 생성, ERUTY 회사 소개 PDF 첨부, 중복 방지와 발송 제한을 구현했습니다. 사용자의 후속 요청에 따라 **실제 발신 주소 연결과 수신 테스트는 보류**했습니다. `RESEND_FROM_EMAIL` 설정 전에는 발송 준비 중으로 표시합니다. `RESEND_API_KEY`와 발신 주소는 서버의 Vercel Production 환경에만 등록합니다.

## 이전 운영본

이메일 인증과 다자산 투자 모드는 [보관 브랜치](https://github.com/kimue7057/Investment_project_ERU_AI/tree/codex/archive-main-before-bitcoin-20261115)의 `ef21d3d`에 있습니다. 기존 계정·거래·시세 데이터는 삭제하지 않았습니다. 원본 ZIP, README_V2.md, source_index.csv와 archive도 보존합니다.

## 개발·검증

프론트엔드 의존성과 빌드는 로컬 캐시를 사용하는 `scripts/BUILD.ps1`로 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/BUILD.ps1
& "$env:LOCALAPPDATA\ERU-AI\alpha-v1-venv\Scripts\python.exe" -m pytest tests -q
Push-Location archive/ERU_AI_Investment_Simulator_V2
& "$env:LOCALAPPDATA\ERU-AI\alpha-v1-venv\Scripts\python.exe" -m unittest discover -s tests -v
Pop-Location
```

데이터·계산·공개 경계·메일 상태·배포 원본 보관은 [비트코인 자동 비교 V1 구현 기록](docs/비트코인_자동비교_V1.md)을 확인하세요. 시세 원본·정규화 CSV·DB·인증정보는 커밋하지 않습니다.
