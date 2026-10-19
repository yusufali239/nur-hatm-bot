import logging
from html import escape as _html_escape
from typing import Optional

from aiogram import Bot
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from sqlalchemy import select

from backend.config import settings
from backend.database import AsyncSessionLocal
from backend.models import HatmStatus, JuzStatus, User
from backend.services import (
    get_active_hatm,
    get_leaderboard,
    release_all_juzs_for_blocked_user,
)

logger = logging.getLogger("nur_hatm.bot.channel")


def esc(value) -> str:
    """Escape user-controlled text before inserting it into HTML parse_mode messages."""
    return _html_escape(str(value or ""), quote=False)


def build_channel_hatm_text(hatm, top_user: Optional[User]) -> str:
    """
    Generates a clean, Apple-style structured Telegram Channel post for the live Hatm board,
    including the Top reader badge at the bottom: `🏆 Top: Ҳумайро - 142 пора`.
    """
    sorted_juzs = sorted(hatm.juzs, key=lambda j: j.number)
    done_count = sum(1 for j in sorted_juzs if j.status == JuzStatus.DONE.value)
    booked_count = sum(1 for j in sorted_juzs if j.status == JuzStatus.BOOKED.value)
    free_count = sum(1 for j in sorted_juzs if j.status == JuzStatus.FREE.value)

    progress_pct = int((done_count / 30) * 100)
    filled_blocks = int(done_count / 3)
    bar = "🟨" * filled_blocks + "🟩" * int(booked_count / 3)
    bar = (bar + "⬜" * 10)[:10]

    lines = [
        f"🌙 <b>{esc(hatm.title)}</b>",
    ]
    if hatm.dedication:
        lines.append(f"<i>«{esc(hatm.dedication)}»</i>\n")
    else:
        lines.append("")

    lines.append(
        f"📊 <b>Ҳолат:</b> {done_count}/30 ўқилди ({progress_pct}%) | ⏳ Банд: {booked_count} | ⚪ Бўш: {free_count}"
    )
    lines.append(f"<code>[{bar}]</code>\n")

    # Compact 3-column or clean list of 30 Juzs
    juz_lines = []
    for j in sorted_juzs:
        if j.status == JuzStatus.DONE.value:
            reader = esc(j.user_name or "Муслим")
            juz_lines.append(f"✅ <b>{j.number:02d}-пора:</b> {reader} <i>(Ўқилди)</i>")
        elif j.status == JuzStatus.BOOKED.value:
            reader = esc(j.user_name or "Муслим")
            juz_lines.append(f"🟢 <b>{j.number:02d}-пора:</b> {reader} <i>(Ўқилмоқда ⏳)</i>")
        else:
            juz_lines.append(f"⚪ <b>{j.number:02d}-пора:</b> <i>Бўш — танлаш мумкин</i>")

    lines.extend(juz_lines)
    lines.append("")

    if hatm.dua_done:
        lines.append("🤲 <b>Ушбу Хатми Қуръон дуоси қилинди! Аллоҳ қабул айласин!</b>\n")

    if top_user and top_user.total_juz > 0:
        lines.append(f"🏆 Top: {esc(top_user.name)} — {top_user.total_juz} пора ({top_user.rating_points} балл)")

    return "\n".join(lines)


def build_channel_keyboard(hatm_id: Optional[int] = None) -> InlineKeyboardMarkup:
    # Deep link directly to the Telegram bot itself
    bot_url = settings.bot_link(hatm_id)
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📖 Пора олиш",
                    url=bot_url,
                )
            ]
        ]
    )


async def delete_channel_post(bot: Optional[Bot], message_id: int) -> None:
    if not bot or not settings.CHANNEL_ID or not message_id:
        return
    try:
        await bot.delete_message(chat_id=settings.CHANNEL_ID, message_id=message_id)
    except Exception as exc:
        logger.warning(f"Could not delete channel message {message_id}: {exc}")


async def sync_channel_board(bot: Optional[Bot], hatm_id: Optional[int] = None) -> None:
    """
    Debounced channel board updater (called at most once every 3 seconds per hatm).
    Creates or edits the live Hatm post in `settings.CHANNEL_ID`.
    """
    if not bot or not settings.CHANNEL_ID:
        return

    async with AsyncSessionLocal() as session:
        hatm = await get_active_hatm(session, hatm_id)
        top_stmt = (
            select(User)
            .where(User.total_juz > 0)
            .order_by(User.rating_points.desc(), User.total_juz.desc())
            .limit(1)
        )
        top_user = (await session.execute(top_stmt)).scalar_one_or_none()

        text = build_channel_hatm_text(hatm, top_user)
        kb = build_channel_keyboard(hatm.id)

        try:
            if hatm.channel_message_id:
                await bot.edit_message_text(
                    chat_id=settings.CHANNEL_ID,
                    message_id=hatm.channel_message_id,
                    text=text,
                    parse_mode=ParseMode.HTML,
                    reply_markup=kb,
                )
            else:
                msg = await bot.send_message(
                    chat_id=settings.CHANNEL_ID,
                    text=text,
                    parse_mode=ParseMode.HTML,
                    reply_markup=kb,
                )
                hatm.channel_message_id = msg.message_id
                await session.commit()
        except TelegramBadRequest as exc:
            if "message is not modified" not in str(exc).lower():
                logger.warning(f"Channel edit warning: {exc}")
        except Exception as exc:
            logger.warning(f"Could not sync channel post: {exc}")


async def send_user_notification(bot: Optional[Bot], user_id: int, text: str) -> None:
    """
    Sends a short Telegram DM to a user. If the user has blocked/banned the bot
    (`TelegramForbiddenError`), automatically releases all of their active booked Juzs!
    """
    if not bot:
        return

    try:
        kb = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📖 Очиш",
                        web_app=WebAppInfo(url=settings.WEBAPP_URL),
                    )
                ]
            ]
        )
        await bot.send_message(
            chat_id=user_id,
            text=text,
            parse_mode=ParseMode.HTML,
            reply_markup=kb,
        )
    except TelegramForbiddenError:
        logger.warning(f"User {user_id} blocked the bot! Releasing their booked Juzs.")
        async with AsyncSessionLocal() as session:
            await release_all_juzs_for_blocked_user(session, user_id)
    except Exception as exc:
        logger.debug(f"Could not send notification to {user_id}: {exc}")

