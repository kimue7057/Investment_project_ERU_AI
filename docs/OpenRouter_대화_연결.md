# OpenRouter 대화 연결

## 현재 설정

서버의 `OPENROUTER_API_KEY`로 `https://openrouter.ai/api/v1/chat/completions`를 호출합니다. Vercel은 앱 배포와 비공개 세션 저장을 담당합니다. 기존 OpenAI 직접 연결 및 Vercel AI Gateway 자격증명은 AI 호출에서 사용하지 않습니다.

- `OPENROUTER_API_KEY`: Vercel Production Secret. 실제 값을 조회·출력·커밋하거나 브라우저에 전달하지 않습니다.
- `OPENROUTER_MODEL`: 선택 설정. 기본 `openai/gpt-6-luna`.
- 구현 시 공식 `/api/v1/models` 목록에서 기본 모델의 `response_format`, `structured_outputs`, `reasoning`, `max_tokens` 지원을 확인했습니다.
- `provider.require_parameters=true`, `response_format=json_schema`, `strict=true`로 구조화 출력 지원 제공업체에 요청합니다. 모델을 변경할 때는 해당 모델과 제공업체의 지원을 다시 확인해야 합니다.
- `reasoning.effort=low`, `reasoning.exclude=true`. 내부 추론 내용은 공개하지 않습니다.
- 설명 생성과 독립 근거 검토에 질문당 두 요청을 사용합니다. 읽기 제한 22초/10초, 연결 제한 5초이며 자동 재시도는 없습니다. 게임당 질문 40회·최소 2초 간격·UUID 중복 처리를 유지합니다.
- 응답의 `finish_reason=stop`과 JSON 형식을 확인합니다. 잘린 응답·거절·HTTP 200 안의 오류·추론 텍스트·원문 오류는 공개하지 않습니다. 연결 실패 시 검증된 규칙 기반 안내와 실패 이유를 표시합니다.

## 사용자 흐름과 공개 경계

성향·현금/투자 비중·선택 종목·정확한 상담 배분과 리스크 초안, 최근 12개 질문과 답변 및 제안, 현재 공개된 사실과 미해결 가드 근거를 전달합니다. 원본 시세·원문 URL·실제 식별자·미래 이벤트·미확정 일봉은 전달하지 않습니다. 외부 도구와 웹 검색은 제공하지 않습니다.

응답은 기존의 필드·설명 근거·비중·식별자·연도 검사와 별도 근거 검토를 거칩니다. 비중 초안을 적용해도 거래하지 않으며, 별도 승인한 주문만 다음 일봉 시가에 체결합니다. 서버 시계·Decimal 장부·실제 시세·이자 계산은 변경하지 않았습니다. 모델의 의미 검토에는 한계가 있어 규칙 검사와 공개 경계 회귀 테스트를 함께 유지합니다.

## 연결 상태와 오류

정상 답변에는 `OpenRouter 연결 · openai/gpt-6-luna`처럼 실제 연결 경로와 요청 모델을 표시합니다. 기존 대화의 OpenAI 오류 기록은 당시 상태로 보존하며 새 답변부터 새 연결을 사용합니다.

- 401: OpenRouter 키 인증 실패. 새 키 등록 또는 키 설정 확인.
- 402: OpenRouter 크레딧 잔액 또는 키 사용 한도 확인.
- 429: 요청 한도 초과. 잠시 후 재시도.
- 400/403/404: 모델 권한·구조화 출력 설정 확인.
- 제공업체 오류·타임아웃·출력 검증 실패는 각각 구분해서 안내합니다.

환경변수는 [Vercel 프로젝트 설정](https://vercel.com/eruty1/eru-ai-investment-simulator/settings/environment-variables)의 Production에 Secret으로 등록하고 새 배포로 반영합니다. 기존 OpenAI 키를 삭제하거나 OpenRouter 키를 OpenAI 서버로 보내지 않습니다. 로컬 검증은 가짜 키와 HTTP 응답을 사용합니다.

## 검증

백엔드 전체 pytest, 기존 archive unittest 10개, 프론트엔드 타입 검사·테스트·빌드를 실행합니다. 브라우저 실제 연결 검증은 `ERU_BASE_URL=https://eru-ai-investment-simulator.vercel.app`, `ERU_REQUIRE_AI=1`로 `scripts/conversation_smoke.cjs`를 실행합니다. 현행 초기 화면은 [세 상담 페이지와 사용자 선택](세_상담페이지와_사용자선택.md)을 따릅니다. `scripts/guided_smoke.cjs`의 단계형 초기 진입은 이전 UI 검증 기록이며, 현재는 새 상담 스크립트와 기존 게임 복원 스크립트를 사용합니다. 원시 세션·화면·대화 결과는 Git에서 제외한 test-results에 저장합니다.

공식 근거: [인증](https://openrouter.ai/docs/api_reference/authentication), [API 연결](https://openrouter.ai/docs/quickstart), [구조화 출력](https://openrouter.ai/docs/guides/features/structured-outputs), [추론 설정](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

## 운영 검증 결과

- 소스 `df43303`, 운영 배포 `dpl_8q17ubwUBkmbfhdvR6o11XdYXF1M`, [테스트 사이트](https://eru-ai-investment-simulator.vercel.app/?setup=1).
- pytest 91개, archive unittest 10개, 프론트엔드 타입 검사·테스트 5개·빌드 통과.
- 운영 대화 세 응답 모두 source=ai 및 `OpenRouter 연결 · openai/gpt-6-luna` 확인. 선택한 성향·종목·현금30/A42/B28 설명, 현금50/A30/B20 제안, 직전 제안의 비율을 유지한 현금60/A24/B16 후속 제안이 통과했습니다.
- 초안 적용 전후 거래·대기 주문 없음, 준비 시간 정지, 재접속 대화 복구, 320/390px 가로 넘침 없음, 실제 식별자·미래 가격 요청의 boundary 응답을 확인했습니다. 브라우저 오류 0.
- 운영 이자 질문과 집중도 가드의 유지/보유 수량25% 매도 비교에서도 실제 AI 응답을 확인했습니다. 논의만으로 시점·거래·대기 주문이 바뀌지 않았고 별도 승인 후 초기 매수·일부 매도·현금100% 조정 총 3건이 체결됐습니다. 정지 중 이자 고정·복원·모바일 통과, 브라우저 오류 및 일시 읽기 오류 0.
- 이번 운영 브라우저 검증은 핵심 흐름 모드입니다. 시계·장부는 변경하지 않았으며 백엔드 전체 실제 시세 재생 회귀를 통과했습니다. 종전의 운영 300초 완주 기록은 V3 구현 문서에 보존합니다.
