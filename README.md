# ERU · 모의투자 V2

실제 과거 시세로 직접 종목을 사고파는 5분 모의투자입니다. 가상 현금 **1억 원**으로 시작하며 코인 A~D를 거래합니다.

## 바로 실행

**[온라인에서 모의투자 시작하기 →](https://eru-ai-investment-simulator.vercel.app)**

1. 종목을 눌러 가격·차트·종목 정보를 살펴봅니다.
2. `모의투자 시작`을 누르거나 종목 화면에서 `모의투자 시작하고 매수 주문 확인`을 누릅니다.
3. 매수 금액을 입력하고 주문을 접수합니다. 판단할 때는 시장이 정지합니다.
4. 주문 내역에서 `시장 재개하고 체결 보기`를 누릅니다. **판단 이후 다음 일봉 시가**에 체결됩니다.
5. `내 투자`에서 보유 수량·현금·평가손익을, `주문 내역 → 체결 완료`에서 체결가·수량·수수료를 확인합니다.
6. 매도는 수량을 입력하거나 25%·50%·전량을 선택합니다. 종료 후 결과와 실제 자산명을 확인하고 재도전할 수 있습니다.

초기 비중 배분, 주식·부동산 준비 중, 새 투자 자료 공개, AI 제안 수용·비율 수정, 신호에 따른 자동 정지를 제거했습니다. 사용자가 직접 누르는 일시정지·시장 재개는 유지합니다. 연결이 오래 끊긴 게임은 시간을 건너뛰지 않도록 안전하게 정지해 복원합니다.

## 공유·검토 링크

| 내용 | 링크 |
|---|---|
| 온라인 플레이 | **[ERU 모의투자](https://eru-ai-investment-simulator.vercel.app)** |
| 서버 상태 | [상태 확인](https://eru-ai-investment-simulator.vercel.app/api/health) |
| 새 디자인 | [Figma V2](https://www.figma.com/design/8hP2vt56sOezV4kF0mAdzI?node-id=48-304) |
| 디자인 설명 | [모의투자 V2 설계](docs/figma/모의투자_V2_설계.md) |
| 배포 구조 | [Vercel 운영 안내](docs/Vercel_배포.md) |
| 이번 구현·검증 | [모의투자 V2 구현 기록](docs/모의투자_V2_구현.md) |
| GitHub | [프로젝트 저장소](https://github.com/kimue7057/Investment_project_ERU_AI) |

현재 화면은 Figma V2를 바탕으로 실제 서버 주문·잔고와 연결한 앱입니다. Figma의 예시 가격과 차트를 게임 데이터로 사용하지 않습니다. 과거 Alpha V1 문서와 기존 Figma UX 페이지는 이전 버전 기록으로 보존합니다.

## 게임·체결 규칙

- 기간: **2022-11-07 00:00 KST~2026-08-05 23:59:59 KST**, 활성 재생 300초. 수동 일시정지 중에는 시간이 흐르지 않습니다.
- 초기 현금은 100,000,000원, 초기 보유 종목은 없습니다. 초기 자동 매수를 하지 않습니다.
- 서버가 시간·시세·수수료·잔고를 계산하고 Decimal 장부로 저장합니다.
- 매수 입력 금액은 **수수료 포함 총예산**입니다. 수수료 0.05%, 예산을 초과해 체결하지 않습니다.
- 매도는 보유 수량 기준입니다. 25%·50%·전량은 서버에서 정확한 보유 수량을 기준으로 계산합니다.
- 현재 표시 가격은 참고용입니다. 체결은 판단 이후 다음 일봉 시가에서 이루어지므로 예상 수량·수령액과 다를 수 있습니다.
- 한 번에 하나의 대기 주문을 접수하며, 체결 전 취소할 수 있습니다. 대기 중 현금 잔고와 주문 예약 금액, 주문 가능 금액을 구분합니다.
- 차트에는 확정된 일봉만 표시합니다. `최근 확정일 등락`은 완료된 두 일봉의 종가를 비교한 값입니다.
- 평균 매입가와 평가손익에는 매수 수수료가 포함됩니다. 총 수익에는 매도 수수료도 반영됩니다.
- 실제 식별자·원문 URL·미래 이벤트·미확정 일봉은 종료 전에 브라우저로 보내지 않습니다. 새 모의투자 응답에는 연구 자료·위험 알림·AI 선택·목표 비중 필드도 없습니다.

원본 업비트 일봉 4종의 자산별 1,592행을 검증해 사용합니다. 데이터 원본·정규화 CSV·세션 DB·인증정보는 Git에 넣지 않습니다. 기존 ZIP·README_V2.md·source_index.csv·archive는 보존합니다. 데이터 이용 범위와 기존 온라인 배포 구조는 [운영 안내](docs/Vercel_배포.md)를 참고하세요.

## Windows 로컬 실행·검증

이 폴더에서 `RUN_ERU_AI.cmd`를 실행한 뒤 [로컬 앱](http://127.0.0.1:8000)을 엽니다. 새 PC는 `SETUP_ERU_AI.cmd`, 종료는 `STOP_ERU_AI.cmd`를 사용합니다.

프론트엔드 의존성과 빌드는 로컬 캐시를 사용하는 `scripts/BUILD.ps1`을 통해 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/BUILD.ps1
& "$env:LOCALAPPDATA\ERU-AI\alpha-v1-venv\Scripts\python.exe" -m pytest tests -q
Push-Location archive/ERU_AI_Investment_Simulator_V2
& "$env:LOCALAPPDATA\ERU-AI\alpha-v1-venv\Scripts\python.exe" -m unittest discover -s tests -v
Pop-Location
```

새 UI의 실제 브라우저 검증은 `scripts/paper_smoke.cjs`로 실행합니다. `ERU_BASE_URL`로 온라인 주소를 지정할 수 있고 `ERU_E2E_QUICK=1`이면 매수·취소·매도·복원·모바일 확인 후 종료합니다. 전체 검증은 실제 활성 300초를 기다려 종료·정체 공개·재도전까지 확인합니다. 테스트 결과와 세션 DB는 Git에서 제외된 `test-results/`에 저장합니다.
