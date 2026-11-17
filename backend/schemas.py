from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr, Field


# --- Enums aligned with MySQL DDL ---
class AdminRole(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    BRAND_ADMIN = "BRAND_ADMIN"
    INFLUENCER_ADMIN = "INFLUENCER_ADMIN"
    CAMPAIGN_ADMIN = "CAMPAIGN_ADMIN"
    FINANCE_ADMIN = "FINANCE_ADMIN"
    REPORTS_ADMIN = "REPORTS_ADMIN"


class OrderStatus(str, Enum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"
    RETURNED_REFUNDED = "RETURNED_REFUNDED"


class CommissionStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    PAYABLE = "PAYABLE"
    PAID = "PAID"
    REVERSED = "REVERSED"


class RegistrationFeeStatus(str, Enum):
    UNPAID = "UNPAID"
    PAID = "PAID"
    EXEMPT = "EXEMPT"


class DealStatus(str, Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CLOSED = "CLOSED"


# --- 1. Admin & Auth DTOs ---
class AdminCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8)
    role: AdminRole


class AdminResponse(BaseModel):
    id: str
    name: str
    email: str
    role: AdminRole
    is_active: bool
    created_at: datetime


# --- 2. Influencer & Blacklist DTOs ---
class InfluencerCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone_number: str = Field(..., pattern=r"^\+?[1-9]\d{7,14}$")
    password: str = Field(..., min_length=8)


class InfluencerBlacklistRequest(BaseModel):
    reason: str = Field(..., min_length=5, max_length=500)


class InfluencerResponse(BaseModel):
    id: str
    name: str
    email: str
    phone_number: str
    registration_fee_status: RegistrationFeeStatus
    is_blacklisted: bool
    blacklist_reason: Optional[str] = None
    created_at: datetime

class CreatorDossierUpdate(BaseModel):
    email: str
    phone_number: str

# --- 3. Brand Deals & Marketplace DTOs ---
class BrandDealCreateRequest(BaseModel):
    brand_id: str
    title: str = Field(..., min_length=3, max_length=200)
    description: Optional[str] = None
    participation_fee: Decimal = Field(default=Decimal("0.00"), ge=Decimal("0.00"))
    commission_percentage: Decimal = Field(..., ge=Decimal("0.01"), le=Decimal("100.00"))


class BrandDealResponse(BaseModel):
    id: str
    brand_id: str
    title: str
    description: Optional[str]
    participation_fee: float
    commission_percentage: float
    deal_status: DealStatus
    created_at: datetime


# --- 4. UGC Video Asset DTOs ---
class UGCVideoCreateRequest(BaseModel):
    brand_id: str
    influencer_id: str
    deal_id: Optional[str] = None
    video_url: str = Field(..., pattern=r"^https?://")
    product_title: str = Field(..., min_length=2, max_length=200)
    product_store_url: str = Field(..., pattern=r"^https?://")


class UGCVideoResponse(BaseModel):
    id: str
    brand_id: str
    influencer_id: str
    deal_id: Optional[str]
    video_url: str
    product_title: str
    product_store_url: str
    unique_tracking_slug: str
    views_count: int
    clicks_count: int
    created_at: datetime


# --- 5. Order & Commission Ingestion DTOs ---
class OrderIngestRequest(BaseModel):
    order_reference: str = Field(..., min_length=1, max_length=100)
    brand_id: str
    influencer_id: str
    ugc_video_id: Optional[str] = None
    customer_phone: Optional[str] = None
    order_amount: Decimal = Field(..., gt=Decimal("0.00"))
    commission_percentage: Decimal = Field(..., ge=Decimal("0.01"), le=Decimal("100.00"))


class OrderStatusUpdateRequest(BaseModel):
    new_order_status: OrderStatus
    reason: Optional[str] = None


class CommissionLedgerResponse(BaseModel):
    id: str
    order_id: str
    influencer_id: str
    commission_rate: float
    commission_amount: float
    commission_status: CommissionStatus
    reversal_reason: Optional[str]
    created_at: datetime

class CreatorDisbursementItem(BaseModel):
    influencer_id: str
    expected_amount: Optional[float] = None

class BatchDisbursementRequest(BaseModel):
    batch_reference: str = Field(..., description="Bank UTR or transfer transaction ID")
    payment_mode: str = Field(default="IMPS", description="NEFT, IMPS, UPI, or MANUAL_WIRE")
    admin_id: Optional[str] = Field(default="admin-root-default")
    admin_notes: Optional[str] = None
    disbursements: List[CreatorDisbursementItem]

# --- 6. Abandoned Cart Recovery DTO ---
class AbandonedCartWebhookRequest(BaseModel):
    brand_id: str
    customer_phone: str = Field(..., pattern=r"^\+?[1-9]\d{7,14}$")
    cart_items: List[Dict[str, Any]]
    cart_value: Decimal = Field(..., gt=Decimal("0.00"))
    recovery_payment_link: str = Field(..., pattern=r"^https?://")

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: str
    brand_id: Optional[str] = None
    influencer_id: Optional[str] = None
    redirect_url: str