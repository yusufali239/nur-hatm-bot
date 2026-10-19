"""
Telegram Mini App initData verification + FastAPI identity helper.
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

Production mode (BOT_TOKEN configured):
    every API call must carry a valid, fresh `X-Telegram-Init-Data` header.
    The user id (and name) always come from the signed data, never from the request body.

Dev mode (BOT_TOKEN empty / placeholder):
    no Telegram is available, so the ids sent by the client are trusted.
    This lets the Mini App be tested in a plain browser; it is never active on a real deploy.
"""
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import parse_qsl

from fastapi import HTTPException, Request

from backend.config import settings

INIT_DATA_HEADER = "X-Telegram-Init-Data"
DEV_USER_ID = 777000


def validate_init_data(
    init_data: str,
    bot_token: str,
    max_age_seconds: Optional[int] = None,
) -> Optional[dict]:
    """
    Returns the Telegram `user` dict if `init_data` is correctly signed by this bot
    (and, when `max_age_seconds` is given, not older than that), else None.
    """
    if not init_data or not bot_token:
        return None
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
        received_hash = pairs.pop("hash", None)
        if not received_hash:
            return None
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        calculated = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calculated, received_hash):
            return None

        if max_age_seconds is not None:
            auth_date = int(pairs.get("auth_date", "0") or 0)
            if auth_date <= 0 or time.time() - auth_date > max_age_seconds:
                return None

        return json.loads(pairs.get("user", "{}")) or None
    except Exception:
        return None


@dataclass
class Identity:
    id: int
    name: Optional[str]
    username: Optional[str]
    verified: bool


def authenticate(
    request: Request,
    claimed_id: Optional[int] = None,
    claimed_name: Optional[str] = None,
    claimed_username: Optional[str] = None,
) -> Identity:
    """
    Resolves who is calling.
    - Dev mode: trusts the claimed values (falls back to the demo user).
    - Production: requires valid signed initData; a mismatching claimed id is rejected.
    """
    if settings.dev_mode:
        return Identity(
            id=claimed_id if claimed_id is not None else DEV_USER_ID,
            name=claimed_name,
            username=claimed_username,
            verified=False,
        )

    tg_user = validate_init_data(
        request.headers.get(INIT_DATA_HEADER, ""),
        settings.BOT_TOKEN.strip(),
        max_age_seconds=settings.INIT_DATA_MAX_AGE_SECONDS,
    )
    if not tg_user or not tg_user.get("id"):
        raise HTTPException(
            status_code=401,
            detail="Telegram орқали киринг: иловани ботдан очинг.",
        )

    tg_id = int(tg_user["id"])
    if claimed_id is not None and int(claimed_id) != tg_id:
        raise HTTPException(status_code=403, detail="Фойдаланувчи мос келмади.")

    full_name = " ".join(
        p for p in (tg_user.get("first_name"), tg_user.get("last_name")) if p
    ).strip()
    return Identity(
        id=tg_id,
        name=full_name or tg_user.get("username") or f"Муслим #{tg_id}",
        username=tg_user.get("username"),
        verified=True,
    )
