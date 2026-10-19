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
_channel_delete_callback = None
_channel_dua_callback = None
_debounce_tasks: Dict[Optional[int], asyncio.Task] = {}


def register_bot_callbacks(channel_sync_fn, user_notify_fn, channel_delete_fn=None, channel_dua_fn=None) -> None:
    global _channel_sync_callback, _user_notify_callback, _channel_delete_callback, _channel_dua_callback
    _channel_sync_callback = channel_sync_fn
    _user_notify_callback = user_notify_fn
    _channel_delete_callback = channel_delete_fn
    _channel_dua_callback = channel_dua_fn


def trigger_debounced_channel_sync(hatm_id: Optional[int] = None) -> None:
    """
    Debounces Telegram Channel live board edits by 3 seconds (configurable) PER HATM,
    so rapid multi-bookings never hit Telegram FloodWait limits and
    changes in different hatms never cancel each other.
    """
    prev = _debounce_tasks.get(hatm_id)
    if prev and not prev.done():
        prev.cancel()

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
        _debounce_tasks[hatm_id] = loop.create_task(_delayed_sync())
    except RuntimeError:
        pass


async def delete_channel_post_safe(message_id: Optional[int]) -> None:
    if message_id and _channel_delete_callback:
        try:
            await _channel_delete_callback(message_id)
        except Exception as exc:
            logger.warning(f"Channel delete error: {exc}")


async def notify_user_safe(user_id: int, text: str) -> None:
    if _user_notify_callback:
        try:
            await _user_notify_callback(user_id, text)
        except Exception as exc:
            logger.warning(f"User notify error for {user_id}: {exc}")


def format_duration(hours: int) -> str:
    """72 -> '3 кун', 36 -> '1 кун 12 соат', 12 -> '12 соат'."""
    days, rem = divmod(int(hours), 24)
    if days and rem:
        return f"{days} кун {rem} соат"
    if days:
        return f"{days} кун"
    return f"{rem} соат"


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
        number=2599,
        title="2599-Хатм",
        dedication="Барча мўмин-мусулмонлар ҳаққига бағишланади",
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
    logger.info("Initialized clean Nur Hatm starting at #2599 with 30 free Juzs.")


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
        # Create a new active Hatm automatically if none exists (starts at 2599)
        max_num_stmt = select(func.max(Hatm.number))
        max_num = (await session.execute(max_num_stmt)).scalar() or 2598
        next_num = max(max_num + 1, 2599)

        hatm = Hatm(
            number=next_num,
            title=f"{next_num}-Хатм",
            dedication="Барча мўмин-мусулмонлар ҳаққига бағишланади",
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
                    f"🎉 <b>{hatm.title}</b> — 30/30 ўқилди. Дуо қилиш мумкин.",
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
        affected_hatms = {r.hatm_id for r in rows}
        for r in rows:
            r.status = JuzStatus.FREE.value
            r.user_id = None
            r.user_name = None
            r.booked_at = None
            r.expires_at = None
            r.warning_sent = False

        await session.commit()
        for hid in affected_hatms:
            trigger_debounced_channel_sync(hid)
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
        next_num = max(hatm.number + 1, 2599)
        new_hatm = Hatm(
            number=next_num,
            title=f"{next_num}-Хатм",
            dedication="Барча мўмин-мусулмонлар ҳаққига бағишланади",
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
    trigger_debounced_channel_sync(hatm.id)
    if new_hatm:
        await session.refresh(new_hatm, attribute_names=["juzs"])
        trigger_debounced_channel_sync(new_hatm.id)

    # Send Dua post directly to the Telegram group / channel (not spamming bot DMs)
    if _channel_dua_callback:
        try:
            await _channel_dua_callback(hatm, new_hatm)
        except Exception as exc:
            logger.warning(f"Group dua callback error: {exc}")

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



def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite returns naive datetimes, Postgres returns aware ones — normalize to UTC-aware."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _clear_juz(juz: Juz) -> None:
    juz.status = JuzStatus.FREE.value
    juz.user_id = None
    juz.user_name = None
    juz.booked_at = None
    juz.expires_at = None
    juz.completed_at = None
    juz.warning_sent = False


# ==========================================
# 👑 ADMIN FULL-CONTROL OPERATIONS
# ==========================================

async def admin_update_hatm(
    session: AsyncSession,
    hatm_id: Optional[int],
    title: Optional[str] = None,
    dedication: Optional[str] = None,
    timer_hours: Optional[int] = None,
    status: Optional[str] = None,
) -> Hatm:
    """
    Edit hatm title / dedication / booking period / status.
    A changed booking period is re-applied to all currently booked juzs
    (expires = booked_at + new period, but never sooner than 1 hour from now,
    so shortening the period never instantly penalizes readers).
    """
    hatm = await get_active_hatm(session, hatm_id)
    now = utcnow()

    if timer_hours and 1 <= timer_hours <= 24 * 30 and timer_hours != hatm.timer_hours:
        hatm.timer_hours = timer_hours
        for j in hatm.juzs:
            if j.status == JuzStatus.BOOKED.value:
                base = _aware(j.booked_at) or now
                j.expires_at = max(base + timedelta(hours=timer_hours), now + timedelta(hours=1))
                j.warning_sent = False

    if title is not None and title.strip():
        hatm.title = title.strip()
    if dedication is not None:
        hatm.dedication = dedication.strip() or None

    if status in (HatmStatus.ACTIVE.value, HatmStatus.COMPLETED.value) and status != hatm.status:
        hatm.status = status
        hatm.completed_at = now if status == HatmStatus.COMPLETED.value else None

    await session.commit()
    await session.refresh(hatm, attribute_names=["juzs"])
    trigger_debounced_channel_sync(hatm.id)
    return hatm


async def admin_set_juz(
    session: AsyncSession,
    hatm_id: Optional[int],
    juz_number: int,
    status: str,
    user_name: Optional[str] = None,
) -> Hatm:
    """
    Admin sets ANY juz to free / booked / done and/or renames its reader.
    - Can assign a juz to an offline reader by name only (no Telegram account).
    - Rating stays consistent: moving a reader's juz into / out of DONE adds / removes points.
    """
    if not (1 <= juz_number <= 30):
        raise ValueError("Пора рақами 1..30 бўлиши керак.")
    if status not in (JuzStatus.FREE.value, JuzStatus.BOOKED.value, JuzStatus.DONE.value):
        raise ValueError("Нотўғри ҳолат.")

    hatm = await get_active_hatm(session, hatm_id)
    juz = next((j for j in hatm.juzs if j.number == juz_number), None)
    if not juz:
        raise ValueError("Пора топилмади.")

    now = utcnow()
    old_status, old_uid = juz.status, juz.user_id
    name = (user_name or "").strip() or None

    if status == JuzStatus.FREE.value:
        _clear_juz(juz)
    else:
        if name:
            juz.user_name = name
        if not juz.user_name:
            raise ValueError("Ўқувчи исмини киритинг.")
        if status == JuzStatus.BOOKED.value:
            if old_status != JuzStatus.BOOKED.value:
                juz.booked_at = now
                juz.expires_at = now + timedelta(hours=hatm.timer_hours)
                juz.warning_sent = False
            juz.completed_at = None
        else:  # DONE
            juz.completed_at = juz.completed_at or now
            juz.expires_at = None
        juz.status = status

    # Keep the reader's rating consistent with the manual change
    if old_uid:
        user = await session.get(User, old_uid)
        if user:
            was_done = old_status == JuzStatus.DONE.value
            is_done = juz.status == JuzStatus.DONE.value and juz.user_id == old_uid
            if was_done and not is_done:
                user.total_juz = max(0, user.total_juz - 1)
                user.rating_points = max(0, user.rating_points - settings.POINTS_ON_COMPLETE)
            elif not was_done and is_done:
                user.total_juz += 1
                user.rating_points += settings.POINTS_ON_COMPLETE

    await session.commit()
    await session.refresh(hatm, attribute_names=["juzs"])
    trigger_debounced_channel_sync(hatm.id)
    return hatm


async def admin_delete_hatm(session: AsyncSession, hatm_id: int) -> str:
    """Deletes a hatm with all its juzs and removes its channel post. Returns the title."""
    stmt = select(Hatm).options(selectinload(Hatm.juzs)).where(Hatm.id == hatm_id)
    hatm = (await session.execute(stmt)).scalar_one_or_none()
    if not hatm:
        raise ValueError("Хатм топилмади.")

    title = hatm.title
    channel_msg_id = hatm.channel_message_id
    await session.delete(hatm)
    await session.commit()

    await delete_channel_post_safe(channel_msg_id)
    return title


# ==========================================
# ⏳ BOOKING PERIOD WORKER
# ==========================================

async def sweep_expired_juzs_once() -> int:
    """
    Background worker pass:
    1) Sends ONE short reminder shortly before a booking expires
       (1 hour before for periods ≤ 24h, otherwise 6 hours before).
    2) Auto-releases expired BOOKED juzs back to FREE.
    3) Applies the rating penalty (`settings.POINTS_ON_EXPIRE_PENALTY`) and increments `expired_count`.
    4) Refreshes the channel post of every affected hatm.
    """
    now = utcnow()
    freed_count = 0

    async with AsyncSessionLocal() as session:
        stmt = select(Juz).where(Juz.status == JuzStatus.BOOKED.value)
        booked_juzs = (await session.execute(stmt)).scalars().all()

        expired_by_user: Dict[int, List[int]] = {}
        warn_by_user: Dict[int, List[Tuple[int, int]]] = {}
        affected_hatms: set = set()

        for juz in booked_juzs:
            exp = _aware(juz.expires_at)
            if not exp:
                continue
            remaining_sec = (exp - now).total_seconds()

            if remaining_sec <= 0:
                uid = juz.user_id
                jnum = juz.number
                affected_hatms.add(juz.hatm_id)
                juz.status = JuzStatus.FREE.value
                juz.user_id = None
                juz.user_name = None
                juz.booked_at = None
                juz.expires_at = None
                juz.warning_sent = False
                freed_count += 1
                if uid:
                    expired_by_user.setdefault(uid, []).append(jnum)
                continue

            booked_at = _aware(juz.booked_at)
            total_sec = (exp - booked_at).total_seconds() if booked_at else 24 * 3600
            warn_window = 3600 if total_sec <= 24 * 3600 else 6 * 3600
            if remaining_sec <= warn_window and not juz.warning_sent and juz.user_id:
                juz.warning_sent = True
                warn_by_user.setdefault(juz.user_id, []).append((juz.number, int(remaining_sec)))

        for uid, jnums in expired_by_user.items():
            user = await get_or_create_user(session, uid)
            penalty = len(jnums) * settings.POINTS_ON_EXPIRE_PENALTY
            user.rating_points = max(0, user.rating_points - penalty)
            user.expired_count += len(jnums)

        await session.commit()

    # Notifications after commit (one short message per user)
    for uid, items in warn_by_user.items():
        nums = ", ".join(str(n) for n, _ in sorted(items))
        left_h = max(1, round(min(s for _, s in items) / 3600))
        await notify_user_safe(uid, f"⏳ {nums}-пора: {left_h} соат қолди")

    for uid, jnums in expired_by_user.items():
        penalty = len(jnums) * settings.POINTS_ON_EXPIRE_PENALTY
        nums = ", ".join(str(n) for n in sorted(jnums))
        await notify_user_safe(uid, f"⌛️ {nums}-пора муддати тугади • −{penalty} балл")

    for hid in affected_hatms:
        trigger_debounced_channel_sync(hid)

    return freed_count


async def expiration_worker_loop(stop_event: asyncio.Event) -> None:
    logger.info("Started background booking-period & auto-release worker.")
    while not stop_event.is_set():
        try:
            await sweep_expired_juzs_once()
        except Exception as exc:
            logger.error(f"Error in expiration_worker_loop: {exc}")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=15.0)
        except asyncio.TimeoutError:
            pass
