from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class JuzStatus(str, Enum):
    FREE = "free"
    BOOKED = "booked"
    DONE = "done"


class HatmStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"


class User(Base):
    """
    Users table (`users`) storing spiritual rating, total Hatm participations,
    total completed Juz (пора), and admin privileges.
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)  # Telegram User ID
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="Муслим")
    username: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    total_hatm: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_juz: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rating_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    expired_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_super_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_bot_blocked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    juz_items: Mapped[List["Juz"]] = relationship("Juz", back_populates="holder")


class Hatm(Base):
    """
    Represents a 30-Juz Quran Hatm cycle.
    Supports custom timer duration and manual Admin Dua completion.
    """
    __tablename__ = "hatms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="Хатми Қуръон")
    dedication: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default=HatmStatus.ACTIVE.value, index=True)

    timer_hours: Mapped[int] = mapped_column(Integer, default=24, nullable=False)
    channel_message_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    dua_done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    dua_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    dua_by_admin_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    dua_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    juzs: Mapped[List["Juz"]] = relationship(
        "Juz",
        back_populates="hatm",
        cascade="all, delete-orphan",
        order_by="Juz.number",
    )


class Juz(Base):
    """
    Represents 1 of 30 Juz (пора) inside a specific Hatm.
    Protected against race conditions by UNIQUE(hatm_id, number) + transactional updates.
    """
    __tablename__ = "juzs"
    __table_args__ = (
        UniqueConstraint("hatm_id", "number", name="uq_hatm_juz_number"),
        Index("ix_juz_status_expires", "status", "expires_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hatm_id: Mapped[int] = mapped_column(Integer, ForeignKey("hatms.id", ondelete="CASCADE"), nullable=False, index=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..30

    status: Mapped[str] = mapped_column(String(24), default=JuzStatus.FREE.value, nullable=False, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    user_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    booked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    warning_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    hatm: Mapped["Hatm"] = relationship("Hatm", back_populates="juzs")
    holder: Mapped[Optional["User"]] = relationship("User", back_populates="juz_items")
