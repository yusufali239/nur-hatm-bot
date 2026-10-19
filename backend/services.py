import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.config import settings
from backend.database import AsyncSessionLocal
from backend.models import Hatm, HatmStatus, Juz, JuzStatus, User, utcnow
from backend.schemas import (
    HatmSchema,
    JuzSchema,
    LeaderboardEntrySchema,
    LeaderboardResponse,
    UserProfileSchema,
)

logger = logging.getLogger("nur_hatm.services")

# Global callbacks hooked by the Telegram Bot instance (if running)
_channel_sync_callback = None
_user_notify_callback = None
_debounce_task: Optional[asyncio.Task] = None


def register_bot_callbacks(channel_sync_fn, user_notify_fn) -> None:
    global _channel_sync_callback, _user_notify_callback
    _channel_sync_callback = channel_sync_fn
    _user_notify_callback = user_notify_fn


def trigger_debounced_channel_sync(hatm_id: Optional[int] = None) -> None:
    """
    Debounces Telegram Channel live board edits by 3 seconds (configurable)
    so rapid multi-bookings never hit Telegram FloodWait limits.
    """
    global _debounce_task
    if _debounce_task and not _debounce_task.done():
        _debounce_task.cancel()

    async def _delayed_sync():
        try:
            await asyncio.sleep(settings.CHANNEL_DEBOUNCE_SECONDS)
            if _channel_sync_callback:
                await _channel_sync_callback(hatm_id)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning(f"Debounced channel sync error: {exc}")

    try:
        loop = asyncio.get_running_loop()
        _debounce_task = loop.create_task(_delayed_sync())
    except RuntimeError:
        pass


async def notify_user_safe(user_id: int, text: str) -> None:
    if _user_notify_callback:
        try:
            await _user_notify_callback(user_id, text)
        except Exception as exc:
            logger.warning(f"User notify error for {user_id}: {exc}")


def get_badge_for_points(points: int, rank: int) -> str:
    if rank == 1 and points > 0:
        return "👑 Пешқадам Қори"
    if points >= 300:
        return "🌟 Фирдавс Фаоли"
    if points >= 100:
        return "💎 Нуроний Қори"
    if points >= 30:
        return "🌙 Садоқатли"
    return "🌱 Хатм Иштирокчиси"


async def get_or_create_user(
    session: AsyncSession,
    user_id: int,
    name: str = "Муслим",
    username: Optional[str] = None,
) -> User:
    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    env_admins = settings.admin_id_list
    is_env_super = user_id in env_admins

    if not user:
        user = User(
            id=user_id,
            name=name or "Муслим",
            username=username,
            total_hatm=0,
            total_juz=0,
            rating_points=0,
            is_admin=is_env_super,
            is_super_admin=is_env_super,
        )
        session.add(user)
        await session.flush()
    else:
        changed = False
        if name and name != "Муслим" and user.name != name:
            user.name = name
            changed = True
        if username and user.username != username:
            user.username = username
            changed = True
        if is_env_super and (not user.is_admin or not user.is_super_admin):
            user.is_admin = True
            user.is_super_admin = True
            changed = True
        if changed:
            await session.flush()

    return user


async def seed_demo_data_if_empty(session: AsyncSession) -> None:
    """
    Creates initial active Hatm #1 with 30 clean free Juzs and registers super admins.
    No fake bot readers are added, ensuring a pristine real-user experience from day one.
    """
    stmt = select(func.count(Hatm.id))
    count = (await session.execute(stmt)).scalar() or 0
    if count > 0:
        return

    # Ensure env super admins exist
    for idx, aid in enumerate(settings.admin_id_list):
        session.add(
            User(
                id=aid,
                name=f"Admin #{idx + 1}",
                total_hatm=0,
                total_juz=0,
                rating_points=0,
                is_admin=True,
                is_super_admin=True,
            )
        )

    hatm = Hatm(
        number=1,
        title="1-Хатми Қуръон",
        dedication="Барча мўмин-мусулмонлар ҳаққига ҳамда юртимиз тинчлиги ва баракаси учун бағишланади",
        status=HatmStatus.ACTIVE.value,
        timer_hours=settings.DEFAULT_TIMER_HOURS,
    )
    session.add(hatm)
    await session.flush()

    for num in range(1, 31):
        session.add(
            Juz(
                hatm_id=hatm.id,
                number=num,
                status=JuzStatus.FREE.value,
            )
        )

    await session.commit()
    logger.info("Initialized clean Nur Hatm #1 with 30 free Juzs.")


async def get_active_hatm(session: AsyncSession, hatm_id: Optional[int] = None) -> Hatm:
    if hatm_id:
        stmt = (
            select(Hatm)
            .options(selectinload(Hatm.juzs))
            .where(Hatm.id == hatm_id)
        )
    else:
        stmt = (
            select(Hatm)
            .options(selectinload(Hatm.juzs))
            .where(Hatm.status == HatmStatus.ACTIVE.value)
            .order_by(Hatm.id.desc())
            .limit(1)
        )
    result = await session.execute(stmt)
    hatm = result.scalar_one_or_none()

    if not hatm:
        # Create a new active Hatm automatically if none exists
        max_num_stmt = select(func.max(Hatm.number))
        max_num = (await session.execute(max_num_stmt)).scalar() or 0
        next_num = max_num + 1

        hatm = Hatm(
            number=next_num,
            title=f"{next_num}-Хатми Қуръон",
            dedication="Аллоҳ розилиги учун хатми Қуръон",
            status=HatmStatus.ACTIVE.value,
            timer_hours=settings.DEFAULT_TIMER_HOURS,
        )
        session.add(hatm)
        await session.flush()

        for num in range(1, 31):
            session.add(
                Juz(
                    hatm_id=hatm.id,
                    number=num,
                    status=JuzStatus.FREE.value,
                )
            )
        await session.commit()
        stmt = select(Hatm).options(selectinload(Hatm.juzs)).where(Hatm.id == hatm.id)
        hatm = (await session.execute(stmt)).scalar_one()

    return hatm


def serialize_hatm(hatm: Hatm) -> HatmSchema:
    sorted_juzs = sorted(hatm.juzs, key=lambda j: j.number)
    free_c = sum(1 for j in sorted_juzs if j.status == JuzStatus.FREE.value)
    booked_c = sum(1 for j in sorted_juzs if j.status == JuzStatus.BOOKED.value)
    done_c = sum(1 for j in sorted_juzs if j.status == JuzStatus.DONE.value)

    return HatmSchema(
        id=hatm.id,
        number=hatm.number,
        title=hatm.title,
        dedication=hatm.dedication,
        status=hatm.status,
        timer_hours=hatm.timer_hours,
        dua_done=hatm.dua_done,
        dua_at=hatm.dua_at,
        dua_by_admin_id=hatm.dua_by_admin_id,
        dua_message=hatm.dua_message,
        created_at=hatm.created_at,
        completed_at=hatm.completed_at,
        free_count=free_c,
        booked_count=booked_c,
        done_count=done_c,
        juzs=[JuzSchema.model_validate(j) for j in sorted_juzs],
    )


async def book_multiple_juzs(
    session: AsyncSession,
    user_id: int,
    user_name: str,
    username: Optional[str],
    juz_numbers: List[int],
    hatm_id: Optional[int] = None,
) -> Tuple[List[int], List[int], Hatm, User]:
    """
    Atomically books any number of Juzs (1, 5, 10, or all 30 — NO LIMIT!).
    Starts a 24h (or custom `hatm.timer_hours`) countdown timer for each booked Juz.
    Uses atomic conditional UPDATE (`WHERE status = 'free'`) inside a transaction
    to prevent race conditions when two users tap the same Juz simultaneously.
    """
    user = await get_or_create_user(session, user_id, user_name, username)
    if user.is_bot_blocked:
        user.is_bot_blocked = False

    hatm = await get_active_hatm(session, hatm_id)
    now = utcnow()
    expires = now + timedelta(hours=hatm.timer_hours)

    unique_numbers = sorted({n for n in juz_numbers if 1 <= n <= 30})
    booked: List[int] = []
    conflict: List[int] = []

    for num in unique_numbers:
        stmt = (
            update(Juz)
            .where(
                Juz.hatm_id == hatm.id,
                Juz.number == num,
                Juz.status == JuzStatus.FREE.value,
            )
            .values(
                status=JuzStatus.BOOKED.value,
                user_id=user.id,
                user_name=user.name,
                booked_at=now,
                expires_at=expires,
                warning_sent=False,
            )
        )
        res = await session.execute(stmt)
        if res.rowcount and res.rowcount > 0:
            booked.append(num)
        else:
            conflict.append(num)

    await session.commit()

    # Refresh hatm & user
    await session.refresh(hatm, attribute_names=["juzs"])
    await session.refresh(user)

    if booked:
        trigger_debounced_channel_sync(hatm.id)

    return booked, conflict, hatm, user


async def complete_user_juzs(
    session: AsyncSession,
    user_id: int,
    juz_numbers: List[int],
    hatm_id: Optional[int] = None,
) -> Tuple[List[int], int, Hatm, User]:
    """
    Marks user's booked Juzs as DONE ([Ўқидим]).
    Awards +10 rating points (`settings.POINTS_ON_COMPLETE`) per completed Juz
    and increments `total_juz` and `total_hatm` if this is their first completed Juz in this Hatm.
    """
    user = await get_or_create_user(session, user_id)
    hatm = await get_active_hatm(session, hatm_id)
    now = utcnow()

    # Check if user already had a completed Juz in this Hatm before this action
    already_completed_in_hatm_stmt = select(func.count(Juz.id)).where(
        Juz.hatm_id == hatm.id,
        Juz.user_id == user_id,
        Juz.status == JuzStatus.DONE.value,
    )
    already_done_count = (await session.execute(already_completed_in_hatm_stmt)).scalar() or 0

    unique_numbers = sorted({n for n in juz_numbers if 1 <= n <= 30})
    completed: List[int] = []

    for num in unique_numbers:
        stmt = (
            update(Juz)
            .where(
                Juz.hatm_id == hatm.id,
                Juz.number == num,
                Juz.status == JuzStatus.BOOKED.value,
                Juz.user_id == user_id,
            )
            .values(
                status=JuzStatus.DONE.value,
                completed_at=now,
                expires_at=None,
            )
        )
        res = await session.execute(stmt)
        if res.rowcount and res.rowcount > 0:
            completed.append(num)

    points_earned = len(completed) * settings.POINTS_ON_COMPLETE
    if completed:
        user.total_juz += len(completed)
        user.rating_points += points_earned
        if already_done_count == 0:
            user.total_hatm += 1

    await session.commit()
    await session.refresh(hatm, attribute_names=["juzs"])
    await session.refresh(user)

    if completed:
        trigger_debounced_channel_sync(hatm.id)

        # Check if all 30 Juzs are now completed
        done_count = sum(1 for j in hatm.juzs if j.status == JuzStatus.DONE.value)
        if done_count == 30 and not hatm.dua_done:
            for admin_id in settings.admin_id_list:
                await notify_user_safe(
                    admin_id,
                    f"🎉 <b>{hatm.title} — Барча 30 та пора тўлиқ ўқилди!</b>\n\n"
                    f"Аллоҳ қабул қилсин! Илтимос, Mini App орқали <b>[🔔 Хатм Дуа қилиш]</b> тугмасини босиб, хатмни дуо қилинг ва навбатдаги хатмни очинг.",
                )

    return completed, points_earned, hatm, user


async def release_user_juzs(
    session: AsyncSession,
    user_id: int,
    juz_numbers: List[int],
    hatm_id: Optional[int] = None,
) -> Tuple[List[int], Hatm, User]:
    """
    Voluntarily releases booked Juzs back to FREE so another reader can take them.
    """
    user = await get_or_create_user(session, user_id)
    hatm = await get_active_hatm(session, hatm_id)
    unique_numbers = sorted({n for n in juz_numbers if 1 <= n <= 30})
    released: List[int] = []

    for num in unique_numbers:
        stmt = (
            update(Juz)
            .where(
                Juz.hatm_id == hatm.id,
                Juz.number == num,
                Juz.status == JuzStatus.BOOKED.value,
                Juz.user_id == user_id,
            )
            .values(
                status=JuzStatus.FREE.value,
                user_id=None,
                user_name=None,
                booked_at=None,
                expires_at=None,
                warning_sent=False,
            )
        )
        res = await session.execute(stmt)
        if res.rowcount and res.rowcount > 0:
            released.append(num)

    await session.commit()
    await session.refresh(hatm, attribute_names=["juzs"])
    await session.refresh(user)

    if released:
        trigger_debounced_channel_sync(hatm.id)

    return released, hatm, user


async def release_all_juzs_for_blocked_user(session: AsyncSession, user_id: int) -> List[int]:
    """
    Automatically releases all currently booked Juzs if a user blocks/bans the Telegram bot.
    """
    user = await get_or_create_user(session, user_id)
    user.is_bot_blocked = True

    stmt = select(Juz).where(
        Juz.user_id == user_id,
        Juz.status == JuzStatus.BOOKED.value,
    )
    rows = (await session.execute(stmt)).scalars().all()
    freed_numbers = [r.number for r in rows]

    if rows:
        for r in rows:
            r.status = JuzStatus.FREE.value
            r.user_id = None
            r.user_name = None
            r.booked_at = None
            r.expires_at = None
            r.warning_sent = False

        await session.commit()
        trigger_debounced_channel_sync()
        logger.info(f"Released Juzs {freed_numbers} because user {user_id} blocked the bot.")
    else:
        await session.commit()

    return freed_numbers


async def get_leaderboard(session: AsyncSession, limit: int = 10) -> LeaderboardResponse:
    """
    Returns Top-10 'Жаннат боғининг энг фаоллари' sorted by rating_points & total_juz.
    """
    stmt = (
        select(User)
        .where(User.total_juz > 0)
        .order_by(User.rating_points.desc(), User.total_juz.desc(), User.total_hatm.desc())
        .limit(limit)
    )
    users = (await session.execute(stmt)).scalars().all()

    total_participants = (
        await session.execute(select(func.count(User.id)).where(User.total_juz > 0))
    ).scalar() or 0
    total_completed_juzs = (
        await session.execute(select(func.coalesce(func.sum(User.total_juz), 0)))
    ).scalar() or 0
    total_completed_hatms = (
        await session.execute(
            select(func.count(Hatm.id)).where(Hatm.dua_done.is_(True))
        )
    ).scalar() or 0

    entries: List[LeaderboardEntrySchema] = []
    for idx, u in enumerate(users, start=1):
        entries.append(
            LeaderboardEntrySchema(
                rank=idx,
                id=u.id,
                name=u.name,
                username=u.username,
                total_hatm=u.total_hatm,
                total_juz=u.total_juz,
                rating_points=u.rating_points,
                badge=get_badge_for_points(u.rating_points, idx),
            )
        )

    return LeaderboardResponse(
        top_users=entries,
        total_participants=total_participants,
        total_completed_juzs=total_completed_juzs,
        total_completed_hatms=max(total_completed_hatms, 1),
    )


async def perform_admin_dua(
    session: AsyncSession,
    admin_id: int,
    hatm_id: Optional[int] = None,
    dua_message: Optional[str] = None,
    start_new_hatm: bool = True,
) -> Tuple[Hatm, Optional[Hatm]]:
    """
    Triggered manually by an Admin at their own discretion via [🔔 Хатм Дуа қилиш],
    even if only 15/30 Juzs are completed!
    Marks current Hatm as Dua Done & Completed, and optionally opens the next Hatm cycle.
    """
    hatm = await get_active_hatm(session, hatm_id)
    now = utcnow()

    default_dua = (
        "🤲 Аллоҳим! Ушбу ўқилган Қуръони Карим оятларининг нури ва савобини "
        "Пайғамбаримиз Муҳаммад Мустафо ﷺ руҳи покларига, барча ўтган мўмин-мусулмонлар "
        "руҳига ҳамда хатмда қатнашган қори ва қорияларимизнинг икки дунё саодатига "
        "васила қилгин! Омин!"
    )

    hatm.dua_done = True
    hatm.dua_at = now
    hatm.dua_by_admin_id = admin_id
    hatm.dua_message = dua_message or default_dua
    hatm.status = HatmStatus.COMPLETED.value
    hatm.completed_at = now

    new_hatm: Optional[Hatm] = None
    if start_new_hatm:
        next_num = hatm.number + 1
        new_hatm = Hatm(
            number=next_num,
            title=f"{next_num}-Хатми Қуръон • Нуроний Давра",
            dedication="Барча иштирокчилар ва уларнинг оила аъзолари ҳаққига дуои хайр",
            status=HatmStatus.ACTIVE.value,
            timer_hours=hatm.timer_hours,
        )
        session.add(new_hatm)
        await session.flush()

        for num in range(1, 31):
            session.add(
                Juz(
                    hatm_id=new_hatm.id,
                    number=num,
                    status=JuzStatus.FREE.value,
                )
            )

    await session.commit()
    await session.refresh(hatm, attribute_names=["juzs"])
    if new_hatm:
        await session.refresh(new_hatm, attribute_names=["juzs"])
        trigger_debounced_channel_sync(new_hatm.id)
    else:
        trigger_debounced_channel_sync(hatm.id)

    # Notify all participants of this Hatm about the Dua
    distinct_user_ids = {j.user_id for j in hatm.juzs if j.user_id}
    for uid in distinct_user_ids:
        await notify_user_safe(
            uid,
            f"🤲 <b>Хатм Дуоси қилинди!</b>\n\n"
            f"<b>{hatm.title}</b> якунланди ва дуоси қилинди.\n"
            f"<i>«{hatm.dua_message}»</i>\n\n"
            f"Аллоҳ таоло ўқиган пораларингизни даргоҳида ҳусни қабул айласин! ✨\n"
            f"Янги очилган хатмда ҳам фаол иштирок этиб, савобларингизни зиёда қилинг!",
        )

    return hatm, new_hatm


async def uncomplete_user_juzs(
    session: AsyncSession,
    user_id: int,
    juz_numbers: List[int],
    hatm_id: Optional[int] = None,
) -> Tuple[List[int], int, Hatm, User]:
    """
    Rollback accidental [Ўқидим] click:
    Reverts status from DONE back to BOOKED, deducts +10 points, restores 24h timer.
    """
    user = await get_or_create_user(session, user_id)
    hatm = await get_active_hatm(session, hatm_id)
    now = utcnow()
    expires = now + timedelta(hours=hatm.timer_hours)

    unique_numbers = sorted({n for n in juz_numbers if 1 <= n <= 30})
    reverted: List[int] = []

    for num in unique_numbers:
        stmt = (
            update(Juz)
            .where(
                Juz.hatm_id == hatm.id,
                Juz.number == num,
                Juz.status == JuzStatus.DONE.value,
                Juz.user_id == user_id,
            )
            .values(
                status=JuzStatus.BOOKED.value,
                completed_at=None,
                expires_at=expires,
            )
        )
        res = await session.execute(stmt)
        if res.rowcount and res.rowcount > 0:
            reverted.append(num)

    points_deducted = len(reverted) * settings.POINTS_ON_COMPLETE
    if reverted:
        user.total_juz = max(0, user.total_juz - len(reverted))
        user.rating_points = max(0, user.rating_points - points_deducted)

    await session.commit()
    await session.refresh(hatm, attribute_names=["juzs"])
    await session.refresh(user)

    if reverted:
        trigger_debounced_channel_sync(hatm.id)

    return reverted, points_deducted, hatm, user


async def reset_current_hatm_data(session: AsyncSession, hatm_id: Optional[int] = None) -> Hatm:
    """
    Admin tool: Resets all 30 Juzs in the active Hatm to FREE,
    allowing a completely clean start from scratch without demo artifacts.
    """
    hatm = await get_active_hatm(session, hatm_id)
    stmt = (
        update(Juz)
        .where(Juz.hatm_id == hatm.id)
        .values(
            status=JuzStatus.FREE.value,
            user_id=None,
            user_name=None,
            booked_at=None,
            expires_at=None,
            completed_at=None,
            warning_sent=False,
        )
    )
    await session.execute(stmt)
    await session.commit()
    await session.refresh(hatm, attribute_names=["juzs"])
    trigger_debounced_channel_sync(hatm.id)
    return hatm


async def sweep_expired_juzs_once() -> int:
    """
    Background worker pass:
    1) Finds any BOOKED Juz whose 24h timer (`expires_at <= now`) has expired.
    2) Auto-releases the Juz back to `FREE` so another user can read it.
    3) Applies the rating penalty (`-5` points via `settings.POINTS_ON_EXPIRE_PENALTY`)
       to the user and increments `expired_count`.
    4) Sends a polite notification via Telegram Bot if possible.
    """
    now = utcnow()
    freed_count = 0

    async with AsyncSessionLocal() as session:
        # Handle SQLite naive vs aware datetime comparison smoothly
        stmt = select(Juz).where(Juz.status == JuzStatus.BOOKED.value)
        booked_juzs = (await session.execute(stmt)).scalars().all()

        expired_by_user: Dict[int, List[int]] = {}

        for juz in booked_juzs:
            if not juz.expires_at:
                continue
            exp = juz.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)

            # Check for <1 hour warning notification
            remaining_sec = (exp - now).total_seconds()
            if 0 < remaining_sec <= 3600 and not juz.warning_sent and juz.user_id:
                juz.warning_sent = True
                mins = int(remaining_sec // 60)
                await notify_user_safe(
                    juz.user_id,
                    f"⏳ <b>Эслатма:</b> Сиз олган <b>{juz.number}-пора</b> таймери тугашига "
                    f"<b>{mins} дақиқа</b> қолди.\n\n"
                    f"Илтимос, ўқиб бўлган бўлсангиз Mini App орқали <b>[✅ Ўқидим]</b> тугмасини босинг!",
                )

            elif remaining_sec <= 0:
                uid = juz.user_id
                jnum = juz.number
                juz.status = JuzStatus.FREE.value
                juz.user_id = None
                juz.user_name = None
                juz.booked_at = None
                juz.expires_at = None
                juz.warning_sent = False
                freed_count += 1

                if uid:
                    expired_by_user.setdefault(uid, []).append(jnum)

        if expired_by_user:
            for uid, jnums in expired_by_user.items():
                user = await get_or_create_user(session, uid)
                penalty = len(jnums) * settings.POINTS_ON_EXPIRE_PENALTY
                user.rating_points = max(0, user.rating_points - penalty)
                user.expired_count += len(jnums)

        await session.commit()

        if freed_count > 0:
            trigger_debounced_channel_sync()
            for uid, jnums in expired_by_user.items():
                penalty = len(jnums) * settings.POINTS_ON_EXPIRE_PENALTY
                nums_str = ", ".join(f"{n}-пора" for n in sorted(jnums))
                await notify_user_safe(
                    uid,
                    f"⚠️ <b>Таймер вақти тугади!</b>\n\n"
                    f"Сиз банд қилган <b>{nums_str}</b> учун 24 соатлик муддат якунланди ва "
                    f"бошқа ўқувчилар учун автоматик бўшатилди.\n"
                    f"📉 Рейтинг: <b>-{penalty} балл</b>.",
                )

    return freed_count


async def expiration_worker_loop(stop_event: asyncio.Event) -> None:
    logger.info("Started background 24h Juz timer & auto-release worker.")
    while not stop_event.is_set():
        try:
            await sweep_expired_juzs_once()
        except Exception as exc:
            logger.error(f"Error in expiration_worker_loop: {exc}")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=15.0)
        except asyncio.TimeoutError:
            pass
