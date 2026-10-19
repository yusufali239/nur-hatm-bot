import logging
from typing import Optional

from aiogram import Bot, Dispatcher, F, Router
from aiogram.enums import ChatMemberStatus, ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    CallbackQuery,
    ChatMemberUpdated,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)
from sqlalchemy import select

from backend.config import settings
from backend.database import AsyncSessionLocal
from backend.models import JuzStatus, User
from backend.services import (
    get_active_hatm,
    get_leaderboard,
    get_or_create_user,
    perform_admin_dua,
    register_bot_callbacks,
    release_all_juzs_for_blocked_user,
)
from bot.channel_manager import send_user_notification, sync_channel_board

logger = logging.getLogger("nur_hatm.bot.handlers")
router = Router()


def get_main_liquid_keyboard(is_admin: bool = False) -> InlineKeyboardMarkup:
    """
    Button-only UX! Users open the Liquid Glass Mini App, view Top-10 Rating,
    or check their active timers with zero text typing required.
    """
    buttons = [
        [
            InlineKeyboardButton(
                text="✨ Пора танлаш",
                web_app=WebAppInfo(url=settings.WEBAPP_URL),
            )
        ],
        [
            InlineKeyboardButton(
                text="🏆 Топ-10 Фаоллар",
                callback_data="show_leaderboard",
            ),
            InlineKeyboardButton(
                text="⏳ Менинг пораларим",
                callback_data="my_juzs",
            ),
        ],
    ]
    if is_admin:
        buttons.append(
            [
                InlineKeyboardButton(
                    text="🔔 Хатм Дуа қилиш (Админ)",
                    callback_data="admin_dua_confirm",
                ),
                InlineKeyboardButton(
                    text="👑 Админ Панел",
                    web_app=WebAppInfo(url=f"{settings.WEBAPP_URL}?tab=admin"),
                ),
            ]
        )
    return InlineKeyboardMarkup(inline_keyboard=buttons)


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    if not message.from_user:
        return

    async with AsyncSessionLocal() as session:
        user = await get_or_create_user(
            session,
            user_id=message.from_user.id,
            name=message.from_user.full_name or "Муслим",
            username=message.from_user.username,
        )
        hatm = await get_active_hatm(session)
        await session.commit()

        done_c = sum(1 for j in hatm.juzs if j.status == JuzStatus.DONE.value)
        free_c = sum(1 for j in hatm.juzs if j.status == JuzStatus.FREE.value)

    welcome = (
        f"🌙 <b>Ассалому алайкум, {user.name}!</b>\n\n"
        f"<b>NUR HATM</b> тизимига хуш келибсиз.\n"
        f"Бу ерда ҳеч қандай <i>«ёзиб қўйинг»</i> дейиш шарт эмас — барча поралар "
        f"<b>илова</b> ичида биргина тугма билан танланади!\n\n"
        f"📖 <b>Жорий хатм:</b> {hatm.title}\n"
        f"✅ Ўқилди: <b>{done_c}/30</b> | ⚪ Бўш поралар: <b>{free_c} та</b>\n"
        f"♾ <b>Лимит йўқ:</b> Бир вақтнинг ўзида 1, 5, 10 ёки барча 30 порани танлашингиз мумкин.\n"
        f"⏱ <b>Таймер:</b> Ҳар бир олинган пора учун <b>{hatm.timer_hours} соат</b> вақт берилади (+10 балл).\n\n"
        f"🌟 <b>Сизнинг рейтингингиз:</b> {user.rating_points} балл ({user.total_juz} пора | {user.total_hatm} хатм)"
    )

    await message.answer(
        welcome,
        parse_mode=ParseMode.HTML,
        reply_markup=get_main_liquid_keyboard(is_admin=user.is_admin),
    )


@router.message(Command("admins"))
async def cmd_admins(message: Message) -> None:
    """
    Super Admin command to manage admins:
    - `/admins` -> lists all current admins & buttons
    - `/admins add 123456789 Исм` -> promotes user to Admin
    - `/admins remove 123456789` -> revokes Admin
    """
    if not message.from_user:
        return

    async with AsyncSessionLocal() as session:
        caller = await get_or_create_user(
            session,
            user_id=message.from_user.id,
            name=message.from_user.full_name or "Admin",
            username=message.from_user.username,
        )
        await session.commit()

        if not (caller.is_super_admin or caller.is_admin):
            await message.answer(
                "🔒 Ушбу буйруқ фақат <b>Super Admin</b> учун мўлжалланган.",
                parse_mode=ParseMode.HTML,
            )
            return

        parts = (message.text or "").strip().split(maxsplit=3)
        if len(parts) >= 3 and parts[1].lower() in ("add", "+"):
            if not caller.is_super_admin:
                await message.answer("Фақат Super Admin янги админ қўша олади.")
                return
            try:
                target_id = int(parts[2])
            except ValueError:
                await message.answer("❌ ID фақат рақамлардан иборат бўлиши керак.")
                return
            target_name = parts[3] if len(parts) >= 4 else f"Admin #{target_id}"
            target_user = await get_or_create_user(session, target_id, target_name)
            target_user.is_admin = True
            await session.commit()
            await message.answer(
                f"✅ Фойдаланувчи <b>{target_user.name}</b> (<code>{target_id}</code>) админ этиб тайинланди!",
                parse_mode=ParseMode.HTML,
            )
            return

        if len(parts) >= 3 and parts[1].lower() in ("remove", "del", "-"):
            if not caller.is_super_admin:
                await message.answer("Фақат Super Admin админни ўчира олади.")
                return
            try:
                target_id = int(parts[2])
            except ValueError:
                await message.answer("❌ ID рақам бўлиши керак.")
                return
            if target_id in settings.admin_id_list:
                await message.answer("⚠️ .env даги Super Admin'ни ўчириб бўлмайди.")
                return
            target_user = await get_or_create_user(session, target_id)
            target_user.is_admin = False
            await session.commit()
            await message.answer(
                f"🗑 Фойдаланувчи <code>{target_id}</code> админликдан чиқарилди.",
                parse_mode=ParseMode.HTML,
            )
            return

        stmt = select(User).where(User.is_admin.is_(True)).order_by(User.is_super_admin.desc(), User.id)
        admins = (await session.execute(stmt)).scalars().all()

        admin_lines = [
            f"{'👑' if a.is_super_admin else '🛡'} <b>{a.name}</b> — <code>{a.id}</code>"
            for a in admins
        ]
        text = (
            "👑 <b>Админлар бошқаруви</b>\n\n"
            + ("\n".join(admin_lines) if admin_lines else "Ҳозирча админлар йўқ.")
            + "\n\n💡 <b>Янги админ қўшиш:</b>\n"
            "<code>/admins add 123456789 Исми</code>\n"
            "<b>Админни ўчириш:</b>\n"
            "<code>/admins remove 123456789</code>\n\n"
            "Ёки илова ичидаги <b>Админ Панел</b> орқали тугмалар билан бошқаринг:"
        )
        await message.answer(
            text,
            parse_mode=ParseMode.HTML,
            reply_markup=get_main_liquid_keyboard(is_admin=True),
        )


@router.callback_query(F.data == "show_leaderboard")
async def cb_show_leaderboard(callback: CallbackQuery) -> None:
    async with AsyncSessionLocal() as session:
        lb = await get_leaderboard(session, limit=10)

    lines = ["🏆 <b>Жаннат боғининг энг фаоллари (Топ-10)</b>\n"]
    medals = {1: "🥇", 2: "🥈", 3: "🥉"}
    for u in lb.top_users:
        m = medals.get(u.rank, f"<b>{u.rank}.</b>")
        lines.append(
            f"{m} <b>{u.name}</b> — {u.total_juz} пора • {u.total_hatm} хатм • <b>{u.rating_points} балл</b>"
        )

    if not lb.top_users:
        lines.append("Ҳозирча ўқилган поралар йўқ. Биринчи бўлиб савоб қозонинг!")

    lines.append(
        f"\n✨ Жами ўқилган поралар: <b>{lb.total_completed_juzs} та</b>"
    )
    await callback.message.answer(
        "\n".join(lines),
        parse_mode=ParseMode.HTML,
        reply_markup=InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="✨ Пора танлаш",
                        web_app=WebAppInfo(url=settings.WEBAPP_URL),
                    )
                ]
            ]
        ),
    )
    await callback.answer()


@router.callback_query(F.data == "my_juzs")
async def cb_my_juzs(callback: CallbackQuery) -> None:
    if not callback.from_user:
        return

    async with AsyncSessionLocal() as session:
        user = await get_or_create_user(
            session,
            callback.from_user.id,
            callback.from_user.full_name or "Муслим",
            callback.from_user.username,
        )
        hatm = await get_active_hatm(session)
        my_booked = [j for j in hatm.juzs if j.user_id == user.id and j.status == JuzStatus.BOOKED.value]
        my_done = [j for j in hatm.juzs if j.user_id == user.id and j.status == JuzStatus.DONE.value]

    booked_str = ", ".join(f"{j.number}-пора" for j in my_booked) if my_booked else "Йўқ"
    done_str = ", ".join(f"{j.number}-пора" for j in my_done) if my_done else "Йўқ"

    text = (
        f"👤 <b>{user.name} — Шахсий Кабинет</b>\n\n"
        f"🌟 Рейтинг: <b>{user.rating_points} балл</b>\n"
        f"📖 Жами ўқилган поралар: <b>{user.total_juz} та</b>\n"
        f"🌙 Иштирок этган хатмлар: <b>{user.total_hatm} та</b>\n\n"
        f"⏳ <b>Жорий хатмда банд қилинган:</b> {booked_str}\n"
        f"✅ <b>Жорий хатмда ўқилган:</b> {done_str}\n\n"
        f"👇 <i>[Ўқидим] тугмасини босиш ёки янги пора олиш учун иловани очинг:</i>"
    )
    await callback.message.answer(
        text,
        parse_mode=ParseMode.HTML,
        reply_markup=get_main_liquid_keyboard(is_admin=user.is_admin),
    )
    await callback.answer()


@router.callback_query(F.data == "admin_dua_confirm")
async def cb_admin_dua_confirm(callback: CallbackQuery) -> None:
    if not callback.from_user:
        return

    async with AsyncSessionLocal() as session:
        user = await get_or_create_user(session, callback.from_user.id)
        if not user.is_admin:
            await callback.answer("Фақат админлар учун!", show_alert=True)
            return
        hatm = await get_active_hatm(session)
        done_c = sum(1 for j in hatm.juzs if j.status == JuzStatus.DONE.value)

    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🤲 Ҳа, Хатм Дуа қилиш ва янги хатм очиш",
                    callback_data="admin_dua_execute",
                )
            ],
            [
                InlineKeyboardButton(
                    text="❌ Бекор қилиш",
                    callback_data="admin_dua_cancel",
                )
            ],
        ]
    )
    await callback.message.answer(
        f"🔔 <b>Хатм Дуа тасдиқлаш</b>\n\n"
        f"Жорий хатм: <b>{hatm.title}</b>\n"
        f"Ҳозирда ўқилган поралар: <b>{done_c}/30</b>\n\n"
        f"Админ сифатида сиз исталган вақтда (ҳатто 15/30 бўлса ҳам) Хатм Дуосини эълон қилиб, "
        f"навбатдаги хатмни бошлашингиз мумкин. Тасдиқлайсизми?",
        parse_mode=ParseMode.HTML,
        reply_markup=kb,
    )
    await callback.answer()


@router.callback_query(F.data == "admin_dua_execute")
async def cb_admin_dua_execute(callback: CallbackQuery) -> None:
    if not callback.from_user:
        return

    async with AsyncSessionLocal() as session:
        user = await get_or_create_user(session, callback.from_user.id)
        if not user.is_admin:
            await callback.answer("Фақат админлар учун!", show_alert=True)
            return
        finished_hatm, new_hatm = await perform_admin_dua(
            session,
            admin_id=user.id,
            start_new_hatm=True,
        )

    await callback.message.edit_text(
        f"🤲 <b>Алҳамдулиллаҳ! {finished_hatm.title} учун Хатм Дуа қилинди!</b>\n\n"
        f"<i>{finished_hatm.dua_message}</i>\n\n"
        f"✨ Янги <b>{new_hatm.title if new_hatm else ''}</b> автоматик очилди!",
        parse_mode=ParseMode.HTML,
        reply_markup=get_main_liquid_keyboard(is_admin=True),
    )
    await callback.answer("🤲 Хатм Дуа қабул бўлсин!")


@router.callback_query(F.data == "admin_dua_cancel")
async def cb_admin_dua_cancel(callback: CallbackQuery) -> None:
    await callback.message.delete()
    await callback.answer("Бекор қилинди")


@router.my_chat_member()
async def on_my_chat_member(event: ChatMemberUpdated) -> None:
    """
    Detects when a user blocks/bans the bot (`kicked` / `left`)
    and immediately frees all their booked Juzs so the Hatm is never stalled!
    """
    new_status = event.new_chat_member.status
    user_id = event.from_user.id

    if new_status in (ChatMemberStatus.KICKED, ChatMemberStatus.LEFT):
        async with AsyncSessionLocal() as session:
            freed = await release_all_juzs_for_blocked_user(session, user_id)
            if freed:
                logger.info(f"User {user_id} blocked bot -> auto-released Juzs: {freed}")


@router.message()
async def reject_free_text_and_show_buttons(message: Message) -> None:
    """
    Enforces Rule #1:
    'Только кнопками в Mini App. Никакого текста "ёзиб куйинг".'
    Any text message sent to the bot is gently redirected to the Mini App button.
    """
    if not message.from_user:
        return

    async with AsyncSessionLocal() as session:
        user = await get_or_create_user(
            session,
            message.from_user.id,
            message.from_user.full_name or "Муслим",
            message.from_user.username,
        )
        await session.commit()

    await message.answer(
        "💎 <b>Илтимос, матн ёзманг («ёзиб қўйинг» шарт эмас)!</b>\n\n"
        "Пора танлаш, бир нечта порани белгилаш ва <b>[✅ Ўқидим]</b> тугмасини босиш "
        "фақат пастдаги <b>Пора танлаш</b> тугмаси орқали амалга оширилади 👇",
        parse_mode=ParseMode.HTML,
        reply_markup=get_main_liquid_keyboard(is_admin=user.is_admin),
    )


def setup_bot() -> Optional[ tuple[Bot, Dispatcher] ]:
    token = settings.BOT_TOKEN.strip()
    if not token or token.endswith("your_telegram_bot_token_here"):
        logger.warning("BOT_TOKEN is not set or is placeholder. Running in API-only mode until BOT_TOKEN is provided.")
        return None

    try:
        bot = Bot(token=token)
        dp = Dispatcher()
        dp.include_router(router)

        async def _sync_cb(hatm_id: Optional[int] = None):
            await sync_channel_board(bot, hatm_id)

        async def _notify_cb(user_id: int, text: str):
            await send_user_notification(bot, user_id, text)

        register_bot_callbacks(_sync_cb, _notify_cb)
        return bot, dp
    except Exception as exc:
        logger.error(f"Failed to initialize Telegram Bot: {exc}")
        return None
