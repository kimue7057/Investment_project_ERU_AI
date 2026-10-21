"""기존 장부/시계 회귀 검증은 고정 신원으로 실행한다. 인증 경계는 별도 실제 경로로 검증한다."""
import pytest


@pytest.fixture(autouse=True)
def existing_ledger_test_identity(request, monkeypatch):
    if request.path.name == "test_account_auth.py":
        return
    from backend.app import main
    from backend.app.account_auth import Account

    class LedgerIdentity:
        configured = True

        def authenticate(self, request):
            return Account("11111111-1111-4111-8111-111111111111", "ledger@example.test"), None

    monkeypatch.setattr(main, "auth_service", LedgerIdentity())
    # 과거 스냅샷 fixture에는 owner_id가 없다. 해당 테스트의 가격·시계·장부만 보존한다.
    monkeypatch.setattr(main, "authorize_game", lambda state: None)
