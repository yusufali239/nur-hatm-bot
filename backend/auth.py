"""
Telegram Mini App initData verification.
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""
import hashlib
import hmac
import json
from typing import Optional
from urllib.parse import parse_qsl


def validate_init_data(init_data: str, bot_token: str) -> Optional[dict]:
    """Returns the Telegram `user` dict if `init_data` is correctly signed by this bot, else None."""
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
        return json.loads(pairs.get("user", "{}")) or None
    except Exception:
        return None
