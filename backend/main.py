import asyncio
import logging
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import AsyncSessionLocal, get_db, init_db
from backend.models import Hatm, HatmStatus, Juz, JuzStatus, User, utcnow
from backend.schemas import (
    ActionJuzRequest,
    ActionJuzResponse,
    AdminActionRequest,
    BookJuzRequest,
    BookJuzResponse,
    HatmSchema,
    LeaderboardResponse,
    UserProfileSchema,
)
from backend.services import (
    book_multiple_juzs,
    complete_user_juzs,
    expiration_worker_loop,
    get_active_hatm,
    get_leaderboard,
    get_or_create_user,
    perform_admin_dua,
    release_user_juzs,
    seed_demo_data_if_empty,
    serialize_hatm,
    trigger_debounced_channel_sync,
)
from bot.handlers import setup_bot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger("nur_hatm.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with AsyncSessionLocal() as session:
        await seed_demo_data_if_empty(session)

    stop_event = asyncio.Event()
    worker_task = asyncio.create_task(expiration_worker_loop(stop_event))

    bot_pair = setup_bot()
    polling_task: Optional[asyncio.Task] = None
    if bot_pair:
        bot, dp = bot_pair
        logger.info("Starting Aiogram 3 Bot polling in background...")
        polling_task = asyncio.create_task(
            dp.start_polling(bot, handle_signals=False)
        )

    yield

    stop_event.set()
    worker_task.cancel()
    if polling_task:
        polling_task.cancel()
    if bot_pair:
        await bot_pair[0].session.close()


app = FastAPI(
    title="NUR HATM • iOS 26 Liquid Glass API",
    version="2.6.0",
    description="Premium Quran Hatm Mini App & Telegram Bot Backend",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "project": "NUR HATM • Liquid Glass Edition",
        "timer_hours": settings.DEFAULT_TIMER_HOURS,
        "points_on_complete": settings.POINTS_ON_COMPLETE,
        "points_on_expire_penalty": settings.POINTS_ON_EXPIRE_PENALTY,
    }


@app.get("/api/state")
async def get_full_state(
    user_id: int = Query(default=777000, description="Telegram User ID"),
    user_name: str = Query(default="Муслим Фозил", description="Telegram User Name"),
    username: Optional[str] = Query(default=None),
    hatm_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    Single unified endpoint for the Mini App to load:
    - Active Hatm with all 30 Juzs & real-time expiration timestamps
    - Current User profile, rating, and admin flags
    - Top-10 Leaderboard ('Жаннат боғининг энг фаоллари')
    - Recent Hatms history
    """
    user = await get_or_create_user(db, user_id, user_name, username)
    hatm = await get_active_hatm(db, hatm_id)
    leaderboard = await get_leaderboard(db, limit=10)
    await db.commit()

    # Recent Hatms list for switching or viewing Dua history
    recent_stmt = select(Hatm).order_by(Hatm.id.desc()).limit(8)
    recent_hatms = (await db.execute(recent_stmt)).scalars().all()

    return {
        "hatm": serialize_hatm(hatm),
        "user": UserProfileSchema.model_validate(user),
        "leaderboard": leaderboard,
        "recent_hatms": [
            {
                "id": h.id,
                "number": h.number,
                "title": h.title,
                "status": h.status,
                "dua_done": h.dua_done,
                "dua_at": h.dua_at,
                "dua_message": h.dua_message,
            }
            for h in recent_hatms
        ],
    }


@app.post("/api/juz/book", response_model=BookJuzResponse)
async def api_book_juzs(req: BookJuzRequest, db: AsyncSession = Depends(get_db)):
    """
    Multi-select unlimited booking! Users can book 1, 5, 10, or all 30 Juzs at once.
    Protected by atomic row-level SQL transaction (`WHERE status = 'free'`) + `UNIQUE(hatm_id, number)`.
    """
    booked, conflict, hatm, user = await book_multiple_juzs(
        session=db,
        user_id=req.user_id,
        user_name=req.user_name,
        username=req.username,
        juz_numbers=req.juz_numbers,
        hatm_id=req.hatm_id,
    )

    if not booked and conflict:
        msg = f"Танланган поралар ({', '.join(map(str, conflict))}) аллақачон банд қилинган."
        return BookJuzResponse(
            success=False,
            booked=[],
            conflict=conflict,
            message=msg,
            hatm=serialize_hatm(hatm),
            user=UserProfileSchema.model_validate(user),
        )

    nums_str = ", ".join(f"{n}-пора" for n in booked)
    msg = f"Аллоҳ муборак қилсин! {nums_str} сизга банд қилинди ({hatm.timer_hours} соат таймер ишга тушди)."
    if conflict:
        msg += f" (Банд эди: {', '.join(map(str, conflict))})"

    return BookJuzResponse(
        success=True,
        booked=booked,
        conflict=conflict,
        message=msg,
        hatm=serialize_hatm(hatm),
        user=UserProfileSchema.model_validate(user),
    )


@app.post("/api/juz/complete", response_model=ActionJuzResponse)
async def api_complete_juzs(req: ActionJuzRequest, db: AsyncSession = Depends(get_db)):
    """
    User taps [✅ Ўқидим] on one or multiple booked Juzs.
    Grants +10 rating points per Juz!
    """
    completed, points_earned, hatm, user = await complete_user_juzs(
        session=db,
        user_id=req.user_id,
        juz_numbers=req.juz_numbers,
        hatm_id=req.hatm_id,
    )
    if not completed:
        raise HTTPException(
            status_code=400,
            detail="Танланган поралар сизга тегишли эмас ёки аллақачон якунланган.",
        )

    nums_str = ", ".join(f"{n}-пора" for n in completed)
    return ActionJuzResponse(
        success=True,
        processed=completed,
        points_delta=points_earned,
        message=f"МашаАллоҳ! {nums_str} ўқилди деб белгиланди! +{points_earned} рейтинг балли қўшилди 🌟",
        hatm=serialize_hatm(hatm),
        user=UserProfileSchema.model_validate(user),
    )


@app.post("/api/juz/release", response_model=ActionJuzResponse)
async def api_release_juzs(req: ActionJuzRequest, db: AsyncSession = Depends(get_db)):
    """
    User voluntarily cancels/releases their booked Juz back to FREE.
    """
    released, hatm, user = await release_user_juzs(
        session=db,
        user_id=req.user_id,
        juz_numbers=req.juz_numbers,
        hatm_id=req.hatm_id,
    )
    if not released:
        raise HTTPException(
            status_code=400,
            detail="Бўшатиш учун фаол банд қилинган пора топилмади.",
        )

    nums_str = ", ".join(f"{n}-пора" for n in released)
    return ActionJuzResponse(
        success=True,
        processed=released,
        points_delta=0,
        message=f"{nums_str} бошқа ўқувчилар учун бўшатилди.",
        hatm=serialize_hatm(hatm),
        user=UserProfileSchema.model_validate(user),
    )


@app.get("/api/leaderboard", response_model=LeaderboardResponse)
async def api_get_leaderboard(
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    return await get_leaderboard(db, limit=limit)


# ==========================================
# 👑 LIQUID GLASS ADMIN ENDPOINTS
# ==========================================

async def verify_admin_or_demo(db: AsyncSession, admin_id: int) -> User:
    user = await get_or_create_user(db, admin_id)
    # Allow seamless testing in local/demo preview or if user is an admin
    if not user.is_admin and admin_id not in settings.admin_id_list and admin_id != 777000:
        raise HTTPException(status_code=403, detail="Фақат админлар учун рухсат берилган.")
    return user


@app.get("/api/admin/overview")
async def api_admin_overview(
    admin_id: int = Query(default=777000),
    db: AsyncSession = Depends(get_db),
):
    await verify_admin_or_demo(db, admin_id)
    stmt = select(User).where(User.is_admin.is_(True)).order_by(User.is_super_admin.desc(), User.id)
    admins = (await db.execute(stmt)).scalars().all()
    hatm = await get_active_hatm(db)

    return {
        "admins": [UserProfileSchema.model_validate(a) for a in admins],
        "active_hatm": serialize_hatm(hatm),
    }


@app.post("/api/admin/dua")
async def api_admin_dua(req: AdminActionRequest, db: AsyncSession = Depends(get_db)):
    """
    Manual Admin Dua button `[🔔 Хатм Дуа қилиш]` — Admin triggers this AT WILL,
    even if only 15/30 Juzs are completed!
    """
    await verify_admin_or_demo(db, req.admin_id)
    finished_hatm, new_hatm = await perform_admin_dua(
        session=db,
        admin_id=req.admin_id,
        hatm_id=req.hatm_id,
        dua_message=req.dua_message,
        start_new_hatm=req.StartNewHatmAfterDua,
    )
    active = new_hatm or finished_hatm
    return {
        "success": True,
        "message": f"🤲 {finished_hatm.title} учун Хатм Дуоси ўқилди ва сақланди!",
        "finished_hatm": serialize_hatm(finished_hatm),
        "active_hatm": serialize_hatm(active),
    }


@app.post("/api/admin/new-hatm")
async def api_admin_new_hatm(req: AdminActionRequest, db: AsyncSession = Depends(get_db)):
    await verify_admin_or_demo(db, req.admin_id)

    max_num_stmt = select(func.max(Hatm.number))
    max_num = (await db.execute(max_num_stmt)).scalar() or 0
    next_num = max_num + 1

    timer_h = req.timer_hours if req.timer_hours and 1 <= req.timer_hours <= 168 else settings.DEFAULT_TIMER_HOURS
    title = (req.title or "").strip() or f"{next_num}-Хатми Қуръон • Нуроний Давра"
    dedication = (req.dedication or "").strip() or "Барча мўмин-мусулмонлар ҳаққига дуои хайр"

    new_hatm = Hatm(
        number=next_num,
        title=title,
        dedication=dedication,
        status=HatmStatus.ACTIVE.value,
        timer_hours=timer_h,
    )
    db.add(new_hatm)
    await db.flush()

    for num in range(1, 31):
        db.add(
            Juz(
                hatm_id=new_hatm.id,
                number=num,
                status=JuzStatus.FREE.value,
            )
        )

    await db.commit()
    await db.refresh(new_hatm, attribute_names=["juzs"])
    trigger_debounced_channel_sync(new_hatm.id)

    return {
        "success": True,
        "message": f"✨ Янги «{new_hatm.title}» ({timer_h} соат таймер билан) очилди!",
        "active_hatm": serialize_hatm(new_hatm),
    }


@app.post("/api/admin/update-timer")
async def api_admin_update_timer(req: AdminActionRequest, db: AsyncSession = Depends(get_db)):
    await verify_admin_or_demo(db, req.admin_id)
    hatm = await get_active_hatm(db, req.hatm_id)
    if req.timer_hours and 1 <= req.timer_hours <= 168:
        hatm.timer_hours = req.timer_hours
    if req.title:
        hatm.title = req.title.strip()
    if req.dedication is not None:
        hatm.dedication = req.dedication.strip()

    await db.commit()
    await db.refresh(hatm, attribute_names=["juzs"])
    trigger_debounced_channel_sync(hatm.id)

    return {
        "success": True,
        "message": f"⚙️ Хатм созламалари янгиланди (Таймер: {hatm.timer_hours} соат).",
        "active_hatm": serialize_hatm(hatm),
    }


@app.post("/api/admin/force-free-juz")
async def api_admin_force_free_juz(req: AdminActionRequest, db: AsyncSession = Depends(get_db)):
    await verify_admin_or_demo(db, req.admin_id)
    hatm = await get_active_hatm(db, req.hatm_id)
    if not req.juz_number or not (1 <= req.juz_number <= 30):
        raise HTTPException(status_code=400, detail="Пора рақами 1..30 бўлиши керак.")

    stmt = (
        update(Juz)
        .where(Juz.hatm_id == hatm.id, Juz.number == req.juz_number)
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
    await db.execute(stmt)
    await db.commit()
    await db.refresh(hatm, attribute_names=["juzs"])
    trigger_debounced_channel_sync(hatm.id)

    return {
        "success": True,
        "message": f"🔄 {req.juz_number}-пора мажбурий бўшатилди.",
        "active_hatm": serialize_hatm(hatm),
    }


@app.post("/api/admin/manage-admins")
async def api_admin_manage_admins(
    action: str = Query(..., pattern="^(add|remove)$"),
    req: AdminActionRequest = None,
    db: AsyncSession = Depends(get_db),
):
    await verify_admin_or_demo(db, req.admin_id)
    if not req.target_user_id:
        raise HTTPException(status_code=400, detail="target_user_id киритилиши шарт.")

    target = await get_or_create_user(
        db,
        req.target_user_id,
        req.target_user_name or f"Admin #{req.target_user_id}",
    )
    if action == "add":
        target.is_admin = True
        msg = f"✅ {target.name} ({target.id}) админлар сафига қўшилди!"
    else:
        if target.id in settings.admin_id_list:
            raise HTTPException(status_code=400, detail="Super Admin'ни ўчириб бўлмайди.")
        target.is_admin = False
        msg = f"🗑 {target.name} ({target.id}) админликдан чиқарилди."

    await db.commit()
    stmt = select(User).where(User.is_admin.is_(True)).order_by(User.is_super_admin.desc(), User.id)
    admins = (await db.execute(stmt)).scalars().all()

    return {
        "success": True,
        "message": msg,
        "admins": [UserProfileSchema.model_validate(a) for a in admins],
    }
