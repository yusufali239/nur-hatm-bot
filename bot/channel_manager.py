import logging
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


def build_channel_hatm_text(hatm, top_user: Optional[User]) -> str:
    """
    Generates a clean, minimalist Telegram Channel post for the live Hatm board.
    Zero redundant guides or repetitive status words.
    """
    sorted_juzs = sorted(hatm.juzs, key=lambda j: j.number)
    done_count = sum(1 for j in sorted_juzs if j.status == JuzStatus.DONE.value)
    booked_count = sum(1 for j in sorted_juzs if j.status == JuzStatus.BOOKED.value)
    free_count = sum(1 for j in sorted_juzs if j.status == JuzStatus.FREE.value)

    filled_blocks = int(done_count / 3)
    bar = "🟨" * filled_blocks + "🟩" * int(booked_count / 3)
    bar = (bar + "⬜" * 10)[:10]

    lines = [
        f"🌙 <b>{hatm.title}</b>",
    ]
    if hatm.dedication:
        lines.append(f"<i>«{hatm.dedication}»</i>")
    lines.append("")
    lines.append(f"📊 {done_count}/30 ўқилди • ⏳ {booked_count} банд • ⚪ {free_count} бўш")
    lines.append(f"<code>[{bar}]</code>\n")

    juz_lines = []
    for j in sorted_juzs:
        if j.status == JuzStatus.DONE.value:
            reader = j.user_name or "Муслим"
            juz_lines.append(f"✅ <b>{j.number:02d}-пора:</b> {reader}")
        elif j.status == JuzStatus.BOOKED.value:
            reader = j.user_name or "Муслим"
            juz_lines.append(f"⏳ <b>{j.number:02d}-пора:</b> {reader}")
        else:
            juz_lines.append(f"⚪ <b>{j.number:02d}-пора:</b> Бўш")

    lines.extend(juz_lines)
    lines.append("")

    if top_user and top_user.total_juz > 0:
        lines.append(f"🏆 Топ: {top_user.name} — {top_user.total_juz} пора")

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


async def send_group_dua(bot: Optional[Bot], hatm, new_hatm=None) -> None:
    """
    Sends the completion Dua directly to the Telegram group / channel,
    including the Dua text and participant acknowledgments.
    """
    if not bot or not settings.CHANNEL_ID:
        return

    dua_text = (hatm.dua_message or "").strip()
    if not dua_text:
        dua_text = (
            "Аллоҳим! Ушбу ўқилган Қуръони Карим оятларининг нури ва савобини "
            "Пайғамбаримиз Муҳаммад Мустафо ﷺ руҳи покларига, барча ўтган мўмин-мусулмонлар "
            "руҳига ҳамда хатмда қатнашган қори ва қорияларимизнинг икки дунё саодатига "
            "васила қилгин! Омин!"
        )

    # Get distinct readers who completed Juzs in this Hatm
    done_juzs = [j for j in hatm.juzs if j.status == JuzStatus.DONE.value]
    readers = []
    seen = set()
    for j in done_juzs:
        uname = j.user_name or "Муслим"
        if uname not in seen:
            seen.add(uname)
            readers.append(uname)

    lines = [
        f"🤲 <b>{hatm.title} Дуоси</b>\n",
        f"<i>«{dua_text}»</i>\n",
    ]
    if readers:
        readers_str = ", ".join(readers[:15])
        if len(readers) > 15:
            readers_str += f" ва яна {len(readers) - 15} киши"
        lines.append(f"✨ <b>Қатнашганлар:</b> {readers_str}\n")

    lines.append("🤲 Аллоҳ қабул қилсин! Омин!")

    kb = None
    if new_hatm:
        kb = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text=f"📖 {new_hatm.title}га қўшилиш",
                        url=settings.bot_link(new_hatm.id),
                    )
                ]
            ]
        )

    try:
        await bot.send_message(
            chat_id=settings.CHANNEL_ID,
            text="\n".join(lines),
            parse_mode=ParseMode.HTML,
            reply_markup=kb,
        )
    except Exception as exc:
        logger.warning(f"Could not send group dua: {exc}")


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

