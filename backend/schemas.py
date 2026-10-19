from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class UserProfileSchema(BaseModel):
    id: int
    name: str
    username: Optional[str] = None
    total_hatm: int = 0
    total_juz: int = 0
    rating_points: int = 0
    expired_count: int = 0
    is_admin: bool = False
    is_super_admin: bool = False

    model_config = {"from_attributes": True}


class JuzSchema(BaseModel):
    id: int
    hatm_id: int
    number: int
    status: str  # "free" | "booked" | "done"
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    booked_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class HatmSchema(BaseModel):
    id: int
    number: int
    title: str
    dedication: Optional[str] = None
    status: str
    timer_hours: int
    dua_done: bool
    dua_at: Optional[datetime] = None
    dua_by_admin_id: Optional[int] = None
    dua_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    free_count: int = 0
    booked_count: int = 0
    done_count: int = 0
    juzs: List[JuzSchema] = []


class BookJuzRequest(BaseModel):
    user_id: int
    user_name: str = Field(default="Муслим", min_length=1, max_length=255)
    username: Optional[str] = None
    hatm_id: Optional[int] = None
    juz_numbers: List[int] = Field(..., min_length=1, max_length=30)


class BookJuzResponse(BaseModel):
    success: bool
    booked: List[int]
    conflict: List[int]
    message: str
    hatm: HatmSchema
    user: UserProfileSchema


class ActionJuzRequest(BaseModel):
    user_id: int
    user_name: Optional[str] = None
    hatm_id: Optional[int] = None
    juz_numbers: List[int] = Field(..., min_length=1, max_length=30)


class ActionJuzResponse(BaseModel):
    success: bool
    processed: List[int]
    points_delta: int
    message: str
    hatm: HatmSchema
    user: UserProfileSchema


class LeaderboardEntrySchema(BaseModel):
    rank: int
    id: int
    name: str
    username: Optional[str] = None
    total_hatm: int
    total_juz: int
    rating_points: int
    badge: str


class LeaderboardResponse(BaseModel):
    top_users: List[LeaderboardEntrySchema]
    total_participants: int
    total_completed_juzs: int
    total_completed_hatms: int


class AdminActionRequest(BaseModel):
    admin_id: int
    hatm_id: Optional[int] = None
    title: Optional[str] = None
    dedication: Optional[str] = None
    timer_hours: Optional[int] = None
    dua_message: Optional[str] = None
    StartNewHatmAfterDua: bool = True
    target_user_id: Optional[int] = None
    target_user_name: Optional[str] = None
    juz_number: Optional[int] = None
