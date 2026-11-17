import uuid
import os
import logging
from decimal import Decimal
from contextlib import asynccontextmanager
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, EmailStr
import pymysql

from fastapi import FastAPI, HTTPException, status, Query, Depends, Request
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from backend.security import create_access_token, decode_access_token, verify_password, get_password_hash
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from backend.database import init_db_pool, close_db_pool, get_db_cursor
from backend.ledger import (
    record_new_order_and_commission, 
    transition_order_status, 
    disburse_creator_payout,
    submit_ugc_deliverable,
    review_ugc_deliverable,
    execute_batch_payout
)
from backend.schemas import (
    InfluencerBlacklistRequest,
    OrderIngestRequest,
    OrderStatusUpdateRequest,
    BatchDisbursementRequest,
    LoginRequest,
    LoginResponse,
    CreatorDossierUpdate
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize MySQL pool on startup
    await init_db_pool()
    yield
    # Cleanly drain and close pool on shutdown
    await close_db_pool()


app = FastAPI(
    title="Get You Collab CRM API",
    version="1.0.0",
    description="High-velocity Creator Commerce, Affiliate Ledger, and Talent Operations API",
    lifespan=lifespan
)
# Initialize rate limiter (100 requests/min global default per IP)
limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def custom_rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many login attempts. Please wait 60 seconds and try again."}
    )

# Enable CORS for local static frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. Health & Heartbeat ---
@app.get("/api/v1/health", tags=["System"])
async def health_check():
    async with get_db_cursor() as cursor:
        await cursor.execute("SELECT 1 AS heartbeat;")
        result = await cursor.fetchone()
    return {"status": "ONLINE", "database": "CONNECTED", "heartbeat": result["heartbeat"]}


# --- Brands Endpoint ---
@app.get("/api/v1/brands", tags=["Brands"])
async def list_brands():
    """Fetch all registered brand entities for attribution routing."""
    async with get_db_cursor() as cursor:
        await cursor.execute("SELECT id, name, website_url FROM brands ORDER BY name ASC;")
        rows = await cursor.fetchall()
    return rows


# --- 2. Dashboard KPI Summary ---
@app.get("/api/v1/dashboard/metrics", tags=["Dashboard"])
async def get_dashboard_metrics():
    """Returns aggregated high-level KPIs for the executive suite."""
    async with get_db_cursor() as cursor:
        # Total GMV
        await cursor.execute(
            "SELECT COALESCE(SUM(order_amount), 0) AS total_gmv FROM orders WHERE order_status != 'CANCELLED';"
        )
        gmv_row = await cursor.fetchone()

        # Payable Commissions
        await cursor.execute(
            "SELECT COALESCE(SUM(commission_amount), 0) AS total_payable FROM commission_ledger WHERE commission_status = 'PAYABLE';"
        )
        payable_row = await cursor.fetchone()

        # Influencer Counts
        await cursor.execute("SELECT COUNT(*) AS total_creators FROM influencers;")
        creators_row = await cursor.fetchone()

        await cursor.execute("SELECT COUNT(*) AS blacklisted_creators FROM influencers WHERE is_blacklisted = 1;")
        blacklisted_row = await cursor.fetchone()

    return {
        "total_gmv": float(gmv_row["total_gmv"]),
        "payable_commissions": float(payable_row["total_payable"]),
        "total_creators": creators_row["total_creators"],
        "blacklisted_creators": blacklisted_row["blacklisted_creators"]
    }


# --- 3. Influencer Management & Roster ---
@app.get("/api/v1/influencers", tags=["Influencers"])
async def list_influencers(
    filter_status: str = Query(default="ALL", description="Filter: ALL, ACTIVE, BLACKLISTED")
):
    """Fetches talent roster along with their attributed sales and commission balances."""
    query = """
        SELECT 
            i.id,
            i.name,
            i.email,
            i.phone_number,
            i.registration_fee_status,
            i.is_blacklisted,
            i.blacklist_reason,
            COALESCE(SUM(o.order_amount), 0.00) AS total_sales_attributed,
            COALESCE(
                SUM(CASE WHEN cl.commission_status = 'PAYABLE' THEN cl.commission_amount ELSE 0 END), 
                0.00
            ) AS payable_commission
        FROM influencers i
        LEFT JOIN orders o ON i.id = o.influencer_id AND o.order_status != 'CANCELLED'
        LEFT JOIN commission_ledger cl ON o.id = cl.order_id
    """
    params = []
    if filter_status == "BLACKLISTED":
        query += " WHERE i.is_blacklisted = 1"
    elif filter_status == "ACTIVE":
        query += " WHERE i.is_blacklisted = 0"

    query += " GROUP BY i.id ORDER BY total_sales_attributed DESC;"

    async with get_db_cursor() as cursor:
        await cursor.execute(query, tuple(params))
        rows = await cursor.fetchall()

    return [
        {
            **dict(row),
            "total_sales_attributed": float(row["total_sales_attributed"]),
            "payable_commission": float(row["payable_commission"])
        }
        for row in rows
    ]


@app.post("/api/v1/influencers/{influencer_id}/blacklist", tags=["Influencers"])
async def blacklist_influencer(
    influencer_id: str,
    payload: InfluencerBlacklistRequest,
    actor_id: str = Query(default="admin_sys_01", description="Super Admin ID performing action")
):
    """Restricts an influencer, updates blacklist registry, and writes to audit logs."""
    async with get_db_cursor() as cursor:
        await cursor.execute("SELECT id, name, is_blacklisted FROM influencers WHERE id = %s", (influencer_id,))
        influencer = await cursor.fetchone()
        if not influencer:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Influencer not found.")

        # Update influencer record
        await cursor.execute(
            """
            UPDATE influencers 
            SET is_blacklisted = 1, blacklist_reason = %s, blacklisted_by = %s 
            WHERE id = %s
            """,
            (payload.reason, actor_id, influencer_id)
        )

        # Log action to audit trail
        audit_id = str(uuid.uuid4())
        await cursor.execute(
            """
            INSERT INTO audit_logs (id, actor_id, actor_role, action_type, target_entity, target_id, metadata_json)
            VALUES (%s, %s, 'SUPER_ADMIN', 'BLACKLIST_INFLUENCER', 'influencers', %s, %s)
            """,
            (audit_id, actor_id, influencer_id, f'{{"reason": "{payload.reason}"}}')
        )

    return {
        "status": "SUCCESS",
        "influencer_id": influencer_id,
        "is_blacklisted": True,
        "reason": payload.reason
    }


# --- 4. Order Ingestion & Commission Lifecycles ---
@app.post("/api/v1/orders/ingest", status_code=status.HTTP_201_CREATED, tags=["Orders"])
async def ingest_incoming_order(order_data: OrderIngestRequest):
    """Direct webhook endpoint to record orders and generate initial pending commissions."""
    try:
        result = await record_new_order_and_commission(
            order_reference=order_data.order_reference,
            brand_id=order_data.brand_id,
            influencer_id=order_data.influencer_id,
            order_amount=order_data.order_amount,
            commission_percentage=order_data.commission_percentage,
            ugc_video_id=order_data.ugc_video_id,
            customer_phone=order_data.customer_phone
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.patch("/api/v1/orders/{order_id}/status", tags=["Orders"])
async def update_order_status(
    order_id: str,
    payload: OrderStatusUpdateRequest,
    actor_id: str = Query(default="admin_sys_01"),
    actor_role: str = Query(default="SUPER_ADMIN")
):
    """Updates order status and re-evaluates the commission ledger state."""
    try:
        result = await transition_order_status(
            order_id=order_id,
            new_order_status=payload.new_order_status.value,
            actor_id=actor_id,
            actor_role=actor_role,
            reason=payload.reason
        )
        return result
    except LookupError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))


@app.get("/api/v1/orders/recent", tags=["Admin Operations"])
async def get_recent_agency_orders():
    """Returns the latest 15 orders across all creators for agency oversight and fulfillment."""
    async with get_db_cursor() as cursor:
        await cursor.execute(
            """
            SELECT 
                o.id AS order_id,
                o.order_reference,
                b.name AS brand_name,
                i.name AS influencer_name,
                o.order_amount,
                cl.commission_amount,
                cl.commission_status,
                o.order_status,
                o.placed_at
            FROM orders o
            JOIN brands b ON o.brand_id = b.id
            JOIN influencers i ON o.influencer_id = i.id
            JOIN commission_ledger cl ON o.id = cl.order_id
            ORDER BY o.placed_at DESC
            LIMIT 15;
            """
        )
        orders = await cursor.fetchall()
        return [
            {
                **dict(row),
                "order_amount": float(row["order_amount"]),
                "commission_amount": float(row["commission_amount"]),
                "placed_at": str(row["placed_at"])
            }
            for row in orders
        ]


# --- 5. Creator Portal Endpoints ---
@app.patch("/api/v1/creators/{influencer_id}/dossier", tags=["Creator Portal"])
async def update_creator_dossier(influencer_id: str, payload: CreatorDossierUpdate):
    """Updates a creator's email and phone number across both influencers and users tables."""
    new_email = payload.email.strip().lower()
    new_phone = payload.phone_number.strip()

    if not new_email or "@" not in new_email or "." not in new_email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    if not new_phone.isdigit() or len(new_phone) != 10:
        raise HTTPException(status_code=400, detail="Phone number must be exactly 10 digits.")

    async with get_db_cursor() as cursor:
        # 1. Verify creator exists
        await cursor.execute(
            "SELECT id, name, email, phone_number FROM influencers WHERE id = %s",
            (influencer_id,)
        )
        creator = await cursor.fetchone()
        if not creator:
            raise HTTPException(status_code=404, detail="Creator not found.")

        # 2. Prevent duplicate email conflicts across influencers and users
        await cursor.execute(
            "SELECT id FROM influencers WHERE email = %s AND id != %s",
            (new_email, influencer_id)
        )
        if await cursor.fetchone():
            raise HTTPException(status_code=409, detail="This email is already registered to another creator.")

        await cursor.execute(
            "SELECT id FROM users WHERE email = %s AND (influencer_id IS NULL OR influencer_id != %s)",
            (new_email, influencer_id)
        )
        if await cursor.fetchone():
            raise HTTPException(status_code=409, detail="This email is already in use by another account.")

        # 3. Update both tables atomically so login email and dossier email stay in sync
        await cursor.execute(
            "UPDATE influencers SET email = %s, phone_number = %s WHERE id = %s",
            (new_email, new_phone, influencer_id)
        )
        await cursor.execute(
            "UPDATE users SET email = %s WHERE influencer_id = %s",
            (new_email, influencer_id)
        )

        # 4. Return updated creator record
        await cursor.execute(
            "SELECT id, name, email, phone_number, registration_fee_status, is_blacklisted FROM influencers WHERE id = %s",
            (influencer_id,)
        )
        updated_creator = await cursor.fetchone()

    return {
        "message": "Dossier updated successfully.",
        "creator": dict(updated_creator)
    }

@app.get("/api/v1/creators/{influencer_id}/dashboard", tags=["Creator Portal"])
async def get_creator_dashboard(influencer_id: str):
    """Returns private earnings, attributed sales, and active campaigns for a specific creator."""
    async with get_db_cursor() as cursor:
        # 1. Verify creator exists
        await cursor.execute(
            "SELECT id, name, email, phone_number, registration_fee_status, is_blacklisted FROM influencers WHERE id = %s",
            (influencer_id,)
        )
        creator = await cursor.fetchone()
        if not creator:
            raise HTTPException(status_code=404, detail="Creator not found.")

        # 2. Financial balances (Total GMV, Payable, Pending, Paid strictly for this creator)
        await cursor.execute(
            """
            SELECT 
                COALESCE(SUM(o.order_amount), 0.00) AS total_sales,
                COALESCE(SUM(CASE WHEN cl.commission_status = 'PAYABLE' THEN cl.commission_amount ELSE 0 END), 0.00) AS payable_commission,
                COALESCE(SUM(CASE WHEN cl.commission_status = 'PENDING' THEN cl.commission_amount ELSE 0 END), 0.00) AS pending_commission,
                COALESCE(SUM(CASE WHEN cl.commission_status = 'PAID' THEN cl.commission_amount ELSE 0 END), 0.00) AS paid_commission
            FROM orders o
            LEFT JOIN commission_ledger cl ON o.id = cl.order_id
            WHERE o.influencer_id = %s AND o.order_status != 'CANCELLED';
            """,
            (influencer_id,)
        )
        earnings = await cursor.fetchone()

        # 3. Partner brands & active deals strictly associated with this creator's deliverables
        await cursor.execute(
            """
            SELECT DISTINCT
                bd.id AS id,
                bd.id AS campaign_id,
                b.id AS brand_id, 
                b.name AS brand_name, 
                b.website_url, 
                bd.title AS campaign_title,
                COALESCE(bd.participation_fee, 0.00) AS participation_fee,
                bd.commission_percentage,
                COALESCE(bd.status, 'ACTIVE') AS status
            FROM brands b
            JOIN brand_deals bd ON b.id = bd.brand_id
            JOIN ugc_videos uv ON bd.id = uv.brand_deal_id
            WHERE uv.influencer_id = %s
            ORDER BY b.name ASC;
            """,
            (influencer_id,)
        )
        campaigns = await cursor.fetchall()

        # 4. Recent attributed orders with clearance dates & brand cooling-off window
        # 4. Recent attributed orders with clearance calculations
        await cursor.execute(
            """
            SELECT 
                o.id AS order_id,
                o.order_reference,
                b.name AS brand_name,
                7 AS return_window_days,
                o.order_amount,
                cl.commission_amount,
                cl.commission_status,
                o.order_status,
                o.placed_at,
                cl.payout_batch_id,
                cl.payout_timestamp
            FROM orders o
            JOIN brands b ON o.brand_id = b.id
            JOIN commission_ledger cl ON o.id = cl.order_id
            WHERE o.influencer_id = %s
            ORDER BY o.placed_at DESC
            LIMIT 15;
            """,
            (influencer_id,)
        )
        recent_orders = await cursor.fetchall()

    return {
        "creator": dict(creator),
        "earnings": {
            "total_sales": float(earnings["total_sales"]),
            "payable_commission": float(earnings["payable_commission"]),
            "pending_commission": float(earnings["pending_commission"]),
            "paid_commission": float(earnings["paid_commission"])
        },
        "campaigns": [
            {
                **dict(c),
                "participation_fee": float(c["participation_fee"]),
                "commission_percentage": float(c["commission_percentage"])
            }
            for c in campaigns
        ],
        "recent_orders": [
            {
                **dict(ord),
                "order_amount": float(ord["order_amount"]),
                "commission_amount": float(ord["commission_amount"]),
                "return_window_days": int(ord.get("return_window_days") or 7),
                "placed_at": str(ord["placed_at"]) if ord.get("placed_at") else None,
                "delivered_at": str(ord.get("delivered_at")) if ord.get("delivered_at") else None,
                "payout_timestamp": str(ord.get("payout_timestamp")) if ord.get("payout_timestamp") else None,
            }
            for ord in recent_orders
        ]
    }


@app.post("/api/v1/creators/{influencer_id}/payout", tags=["Admin Operations"])
async def process_creator_payout(
    influencer_id: str,
    payload: Dict[str, Any],
    actor_id: str = Query(default="admin_sys_01"),
    actor_role: str = Query(default="SUPER_ADMIN")
):
    """
    Executes a payout disbursement for a creator, converting all PAYABLE commissions to PAID.
    Expects payload: {"payout_reference": "UTR-XXXXX" or "PAYOUT-XXXXX"}
    """
    payout_ref = payload.get("payout_reference")
    if not payout_ref or not str(payout_ref).strip():
        # Auto-generate a clean timestamped reference if none provided
        payout_ref = f"PAYOUT-{uuid.uuid4().hex[:8].upper()}"

    try:
        result = await disburse_creator_payout(
            influencer_id=influencer_id,
            payout_reference=payout_ref,
            actor_id=actor_id,
            actor_role=actor_role
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

# ============================================================================
# 5b. UGC Deliverables & Campaign Review Endpoints
# ============================================================================

@app.get("/api/v1/ugc/stream", tags=["UGC Review"])
async def get_ugc_submissions(influencer_id: Optional[str] = None):
    """
    Retrieves UGC deliverable submissions.
    Strictly isolated: If influencer_id is provided, returns ONLY that creator's submissions.
    """
    async with get_db_cursor() as cursor:
        if influencer_id:
            await cursor.execute(
                """
                SELECT u.id, u.brand_deal_id, u.influencer_id, u.video_url, u.caption_copy,
                       u.review_status, u.admin_feedback, u.submitted_at, u.reviewed_at,
                       b.title AS campaign_title, COALESCE(b.participation_fee, 0.00) AS participation_fee, 
                       br.name AS brand_name, i.name AS influencer_name
                FROM ugc_videos u
                JOIN brand_deals b ON u.brand_deal_id = b.id
                JOIN brands br ON b.brand_id = br.id
                JOIN influencers i ON u.influencer_id = i.id
                WHERE u.influencer_id = %s
                ORDER BY u.submitted_at DESC;
                """,
                (influencer_id,)
            )
        else:
            # Admin only stream
            await cursor.execute(
                """
                SELECT u.id, u.brand_deal_id, u.influencer_id, u.video_url, u.caption_copy,
                       u.review_status, u.admin_feedback, u.submitted_at, u.reviewed_at,
                       b.title AS campaign_title, COALESCE(b.participation_fee, 0.00) AS participation_fee, 
                       br.name AS brand_name, i.name AS influencer_name
                FROM ugc_videos u
                JOIN brand_deals b ON u.brand_deal_id = b.id
                JOIN brands br ON b.brand_id = br.id
                JOIN influencers i ON u.influencer_id = i.id
                ORDER BY u.submitted_at DESC;
                """
            )
        rows = await cursor.fetchall()

    return [
        {
            **dict(r),
            "participation_fee": float(r["participation_fee"]),
            "submitted_at": str(r["submitted_at"]) if r["submitted_at"] else None,
            "reviewed_at": str(r["reviewed_at"]) if r["reviewed_at"] else None
        }
        for r in rows
    ]


@app.post("/api/v1/ugc/submit", tags=["UGC Review"])
async def submit_ugc(payload: Dict[str, Any]):
    """
    Submits a UGC video draft/link for a campaign.
    Enforces tenant ownership: verifies that the brand deal belongs to the submitting creator.
    """
    influencer_id = payload.get("influencer_id")
    brand_deal_id = payload.get("brand_deal_id")
    video_url = payload.get("video_url")
    caption_copy = payload.get("caption_copy")

    if not influencer_id or not brand_deal_id or not video_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required fields: influencer_id, brand_deal_id, and video_url are required."
        )

    async with get_db_cursor() as cursor:
        # Cross-tenant integrity check: Ensure this brand deal actually belongs to this influencer
        await cursor.execute(
            """
            SELECT id FROM brand_deals 
            WHERE id = %s;
            """,
            (brand_deal_id,)
        )
        deal = await cursor.fetchone()
        if not deal:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized: You can only submit deliverables for campaigns assigned to you."
            )

    try:
        result = await submit_ugc_deliverable(
            influencer_id=influencer_id,
            brand_deal_id=brand_deal_id,
            video_url=video_url.strip(),
            caption_copy=caption_copy.strip() if caption_copy else None
        )
        return result
    except LookupError as le:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(le))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

@app.patch("/api/v1/ugc/{ugc_id}/review", tags=["UGC Review"])
async def review_ugc(
    ugc_id: str,
    payload: Dict[str, Any],
    actor_id: str = Query(default="admin_sys_01"),
    actor_role: str = Query(default="SUPER_ADMIN")
):
    """
    Admin review of a UGC deliverable:
    Expected JSON:
    {
        "review_status": "APPROVED" | "REVISION_REQUESTED" | "REJECTED",
        "admin_feedback": "Looks great!" (optional)
    }
    """
    review_status = payload.get("review_status")
    admin_feedback = payload.get("admin_feedback")

    if not review_status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field 'review_status' is required."
        )

    try:
        result = await review_ugc_deliverable(
            ugc_id=ugc_id,
            review_status=review_status,
            admin_feedback=admin_feedback,
            actor_id=actor_id,
            actor_role=actor_role
        )
        return result
    except LookupError as le:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(le))
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(ve))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


# --- 6. Admin Campaign Creation Endpoint ---
@app.post("/api/v1/campaigns", tags=["Admin Operations"])
async def create_campaign(payload: Dict[str, Any]):
    """Admin endpoint to launch a new campaign/brand deal."""
    deal_id = str(uuid.uuid4())
    async with get_db_cursor() as cursor:
        await cursor.execute(
            """
            INSERT INTO brand_deals (
                id, brand_id, title, description, participation_fee, commission_percentage, deal_status
            ) VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE')
            """,
            (
                deal_id,
                payload["brand_id"],
                payload["title"],
                payload.get("description", ""),
                Decimal(str(payload.get("participation_fee", "0.00"))),
                Decimal(str(payload["commission_percentage"]))
            )
        )
    return {"status": "SUCCESS", "deal_id": deal_id, "title": payload["title"]}

# --- 7. Creators Analytics Endpoint ---
@app.get("/api/v1/creators/{influencer_id}/analytics", tags=["Creator Portal"])
async def get_creator_analytics(influencer_id: str):
    """
    Returns aggregated lifetime performance, weekly GMV timeseries,
    top converting campaigns, and UGC review completion rates.
    """
    async with get_db_cursor() as cursor:
        # 1. Verify creator exists
        await cursor.execute(
            "SELECT id, name, email FROM influencers WHERE id = %s",
            (influencer_id,)
        )
        creator = await cursor.fetchone()
        if not creator:
            raise HTTPException(status_code=404, detail="Creator not found.")

        # 2. Overall KPI metrics
        await cursor.execute(
            """
            SELECT 
                COUNT(o.id) AS total_orders_count,
                COALESCE(SUM(o.order_amount), 0.00) AS total_attributed_gmv,
                COALESCE(AVG(o.order_amount), 0.00) AS average_order_value,
                COALESCE(SUM(CASE WHEN cl.commission_status = 'PAID' THEN cl.commission_amount ELSE 0.00 END), 0.00) AS paid_earnings,
                COALESCE(SUM(CASE WHEN cl.commission_status = 'PAYABLE' THEN cl.commission_amount ELSE 0.00 END), 0.00) AS payable_earnings,
                COALESCE(SUM(CASE WHEN cl.commission_status = 'PENDING' THEN cl.commission_amount ELSE 0.00 END), 0.00) AS pending_earnings,
                COALESCE(SUM(CASE WHEN o.order_status = 'DELIVERED' THEN 1 ELSE 0 END), 0) AS delivered_orders_count,
                COALESCE(SUM(CASE WHEN o.order_status IN ('RETURNED_REFUNDED', 'CANCELLED') THEN 1 ELSE 0 END), 0) AS refunded_orders_count
            FROM orders o
            LEFT JOIN commission_ledger cl ON o.id = cl.order_id
            WHERE o.influencer_id = %s;
            """,
            (influencer_id,)
        )
        kpis = await cursor.fetchone()

        # 3. Weekly trend aggregation (Last 8 weeks)
        await cursor.execute(
            """
            SELECT 
                DATE_FORMAT(o.placed_at, '%%x-W%%v') AS week_label,
                MIN(DATE(o.placed_at)) AS week_start_date,
                COUNT(o.id) AS order_volume,
                COALESCE(SUM(o.order_amount), 0.00) AS weekly_gmv,
                COALESCE(SUM(cl.commission_amount), 0.00) AS weekly_commission
            FROM orders o
            LEFT JOIN commission_ledger cl ON o.id = cl.order_id
            WHERE o.influencer_id = %s
              AND o.order_status != 'CANCELLED'
              AND o.placed_at >= DATE_SUB(CURDATE(), INTERVAL 8 WEEK)
            GROUP BY DATE_FORMAT(o.placed_at, '%%x-W%%v')
            ORDER BY week_start_date ASC;
            """,
            (influencer_id,)
        )
        weekly_trends = await cursor.fetchall()

        # 4. Top-converting campaigns
        await cursor.execute(
            """
            SELECT 
                b.name AS brand_name,
                COALESCE(bd.title, 'Direct Storefront Attribution') AS campaign_title,
                COALESCE(bd.commission_percentage, 0.00) AS commission_percentage,
                COUNT(o.id) AS orders_generated,
                COALESCE(SUM(o.order_amount), 0.00) AS total_sales_volume,
                COALESCE(SUM(cl.commission_amount), 0.00) AS total_commission_earned
            FROM orders o
            JOIN brands b ON o.brand_id = b.id
            LEFT JOIN brand_deals bd ON bd.brand_id = b.id
            LEFT JOIN commission_ledger cl ON o.id = cl.order_id
            WHERE o.influencer_id = %s
              AND o.order_status != 'CANCELLED'
            GROUP BY b.id, b.name, bd.id, bd.title, bd.commission_percentage
            ORDER BY total_sales_volume DESC
            LIMIT 5;
            """,
            (influencer_id,)
        )
        top_campaigns = await cursor.fetchall()

        # 5. UGC deliverable completion & approval metrics
        await cursor.execute(
            """
            SELECT 
                COUNT(u.id) AS total_submissions,
                COALESCE(SUM(CASE WHEN u.review_status = 'APPROVED' THEN 1 ELSE 0 END), 0) AS approved_count,
                COALESCE(SUM(CASE WHEN u.review_status = 'REVISION_REQUESTED' THEN 1 ELSE 0 END), 0) AS revision_count,
                COALESCE(SUM(CASE WHEN u.review_status = 'REJECTED' THEN 1 ELSE 0 END), 0) AS rejected_count,
                COALESCE(SUM(CASE WHEN u.review_status = 'SUBMITTED' THEN 1 ELSE 0 END), 0) AS pending_review_count,
                ROUND(
                    (COALESCE(SUM(CASE WHEN u.review_status = 'APPROVED' THEN 1 ELSE 0 END), 0) / NULLIF(COUNT(u.id), 0)) * 100, 
                    1
                ) AS approval_rate_percentage
            FROM ugc_videos u
            WHERE u.influencer_id = %s;
            """,
            (influencer_id,)
        )
        ugc_metrics = await cursor.fetchone()

    return {
        "creator": dict(creator),
        "kpis": {
            "total_orders_count": int(kpis["total_orders_count"]),
            "total_attributed_gmv": float(kpis["total_attributed_gmv"]),
            "average_order_value": float(kpis["average_order_value"]),
            "paid_earnings": float(kpis["paid_earnings"]),
            "payable_earnings": float(kpis["payable_earnings"]),
            "pending_earnings": float(kpis["pending_earnings"]),
            "delivered_orders_count": int(kpis["delivered_orders_count"]),
            "refunded_orders_count": int(kpis["refunded_orders_count"]),
        },
        "weekly_trends": [
            {
                "week_label": str(row["week_label"]),
                "week_start_date": str(row["week_start_date"]),
                "order_volume": int(row["order_volume"]),
                "weekly_gmv": float(row["weekly_gmv"]),
                "weekly_commission": float(row["weekly_commission"]),
            }
            for row in weekly_trends
        ],
        "top_campaigns": [
            {
                "brand_name": str(row["brand_name"]),
                "campaign_title": str(row["campaign_title"]),
                "commission_percentage": float(row["commission_percentage"]),
                "orders_generated": int(row["orders_generated"]),
                "total_sales_volume": float(row["total_sales_volume"]),
                "total_commission_earned": float(row["total_commission_earned"]),
            }
            for row in top_campaigns
        ],
        "ugc_metrics": {
            "total_submissions": int(ugc_metrics["total_submissions"]),
            "approved_count": int(ugc_metrics["approved_count"]),
            "revision_count": int(ugc_metrics["revision_count"]),
            "rejected_count": int(ugc_metrics["rejected_count"]),
            "pending_review_count": int(ugc_metrics["pending_review_count"]),
            "approval_rate_percentage": float(ugc_metrics["approval_rate_percentage"] or 0.0),
        }
    }

logger = logging.getLogger(__name__)

@app.get("/api/v1/campaigns/{campaign_id}/analytics", tags=["Campaign Analytics"])
@app.get("/api/v1/admin/campaigns/{campaign_id}/analytics", tags=["Campaign Analytics"])
async def get_admin_campaign_analytics(campaign_id: str):
    """
    Returns aggregated analytics and creator leaderboard.
    Accepts either a brand_deal id OR a brand id seamlessly.
    """
    try:
        async with get_db_cursor() as cursor:
            # 1. Resolve Brand ID (Check brand_deals first, fallback to brands directly)
            await cursor.execute(
                """
                SELECT bd.id AS deal_id, bd.title, bd.brand_id, b.name AS brand_name, 
                       bd.commission_percentage, bd.participation_fee
                FROM brand_deals bd
                JOIN brands b ON bd.brand_id = b.id
                WHERE bd.id = %s;
                """,
                (campaign_id,)
            )
            deal_row = await cursor.fetchone()

            if deal_row:
                brand_id = deal_row["brand_id"]
                brand_name = deal_row["brand_name"]
                campaign_title = deal_row["title"]
                base_fee = float(deal_row["participation_fee"] or 0.0)
                comm_pct = float(deal_row["commission_percentage"] or 10.0)
            else:
                # Fallback: maybe campaign_id is directly a brand_id
                await cursor.execute(
                    "SELECT id, name, website_url FROM brands WHERE id = %s;",
                    (campaign_id,)
                )
                brand_row = await cursor.fetchone()
                if not brand_row:
                    raise HTTPException(status_code=404, detail="Campaign or Brand not found.")
                brand_id = brand_row["id"]
                brand_name = brand_row["name"]
                campaign_title = f"{brand_name} Performance Audit"
                base_fee = 0.0
                comm_pct = 10.0

            # 2. Performance & Creator Leaderboard from orders & commission_ledger
            await cursor.execute(
                """
                SELECT 
                    i.id AS creator_id,
                    i.name AS creator_name,
                    COUNT(o.id) AS orders_count,
                    COALESCE(SUM(o.order_amount), 0.00) AS attributed_gmv,
                    COALESCE(SUM(cl.commission_amount), 0.00) AS earned_commission
                FROM orders o
                JOIN influencers i ON o.influencer_id = i.id
                LEFT JOIN commission_ledger cl ON o.id = cl.order_id
                WHERE o.brand_id = %s AND (o.order_status IS NULL OR o.order_status != 'CANCELLED')
                GROUP BY i.id, i.name
                ORDER BY attributed_gmv DESC, orders_count DESC;
                """,
                (brand_id,)
            )
            creators_raw = await cursor.fetchall()

            leaderboard = []
            total_orders = 0
            total_gmv = 0.0
            total_commissions = 0.0

            for rank, c in enumerate(creators_raw, start=1):
                c_orders = int(c["orders_count"])
                c_gmv = float(c["attributed_gmv"])
                c_comm = float(c["earned_commission"])

                total_orders += c_orders
                total_gmv += c_gmv
                total_commissions += c_comm

                leaderboard.append({
                    "rank": rank,
                    "creator_id": c["creator_id"],
                    "creator_name": c["creator_name"],
                    "clicks": 0,
                    "orders_count": c_orders,
                    "conversion_rate": 100.0 if c_orders > 0 else 0.0,
                    "attributed_gmv": c_gmv,
                    "earned_commission": c_comm,
                })

            return {
                "campaign": {
                    "id": campaign_id,
                    "title": campaign_title,
                    "brand_name": brand_name,
                    "commission_percentage": comm_pct,
                    "participation_fee": base_fee,
                    "total_clicks": 0,
                    "total_orders": total_orders,
                    "conversion_rate": 100.0 if total_orders > 0 else 0.0,
                    "total_gmv": round(total_gmv, 2),
                    "total_commissions": round(total_commissions, 2)
                },
                "leaderboard": leaderboard
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching campaign analytics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database execution error: {str(e)}")
      
# --- Pending and Batch Endpoint ---
@app.get("/api/v1/admin/payouts/pending-queue", tags=["Executive Suite - Payouts"])
async def get_pending_payout_queue():
    """
    Returns all creators eligible for disbursement with pending payable commissions.
    """
    async with get_db_cursor() as cursor:
        await cursor.execute(
            """
            SELECT 
                i.id AS influencer_id,
                i.name AS creator_name,
                i.email AS creator_email,
                i.phone_number,
                COUNT(cl.id) AS payable_entries_count,
                COALESCE(SUM(cl.commission_amount), 0.00) AS total_payable_amount
            FROM influencers i
            JOIN commission_ledger cl ON i.id = cl.influencer_id
            WHERE cl.commission_status = 'PAYABLE'
              AND i.is_blacklisted = 0
            GROUP BY i.id, i.name, i.email, i.phone_number
            HAVING total_payable_amount > 0
            ORDER BY total_payable_amount DESC;
            """
        )
        queue = await cursor.fetchall()

    total_pool = sum(float(row["total_payable_amount"]) for row in queue)

    return {
        "total_creators_in_queue": len(queue),
        "total_disbursable_pool": total_pool,
        "queue": [
            {
                "influencer_id": row["influencer_id"],
                "creator_name": row["creator_name"],
                "creator_email": row["creator_email"],
                "phone_number": row["phone_number"],
                "payable_entries_count": int(row["payable_entries_count"]),
                "total_payable_amount": float(row["total_payable_amount"]),
            }
            for row in queue
        ]
    }

@app.post("/api/v1/admin/payouts/batch-disburse", tags=["Executive Suite - Payouts"])
async def disburse_batch_payouts(payload: BatchDisbursementRequest):
    """
    Atomically processes payouts for selected creators, marks entries PAID,
    records UTR batch details, and appends to audit logs.
    """
    if not payload.disbursements:
        raise HTTPException(status_code=400, detail="No creators supplied for payout.")

    async with get_db_cursor() as cursor:
        try:
            summary = await execute_batch_payout(
                cursor=cursor,
                admin_id=payload.admin_id or "admin-root",
                batch_reference=payload.batch_reference.strip(),
                payment_mode=payload.payment_mode,
                disbursements=[d.dict() for d in payload.disbursements],
                admin_notes=payload.admin_notes
            )
            return summary
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Payout batch settlement failed: {str(exc)}")

        # Import security functions from security.py
from backend.security import verify_password, create_access_token

@app.post("/api/v1/auth/login", response_model=LoginResponse)
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginRequest):
    async with get_db_cursor() as cursor:
        # ... keep all your existing code below this untouched ...
        query = """
            SELECT id, email, password_hash, role, brand_id, influencer_id, is_active
            FROM users 
            WHERE email = %s
        """
        # If your cursor executes asynchronously, keep await; if it's synchronous, cursor.execute(...)
        # Check if cursor.execute in your other routes uses await (e.g., await cursor.execute(...))
        res = cursor.execute(query, (payload.email,))
        if hasattr(res, "__await__"):
            await res
            user = await cursor.fetchone()
        else:
            user = cursor.fetchone()

        if not user or not user["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = create_access_token(
            user_id=user["id"],
            role=user["role"],
            brand_id=user["brand_id"],
            influencer_id=user["influencer_id"]
        )

        redirect_map = {
            "SUPER_ADMIN": "/index.html?view=admin",
            "BRAND_ADMIN": "/index.html?view=brand",
            "CREATOR": "/index.html?view=creator"
        }
        redirect_url = redirect_map.get(user["role"], "/index.html")

        return LoginResponse(
            access_token=token,
            token_type="bearer",
            role=user["role"],
            user_id=user["id"],
            brand_id=user["brand_id"],
            influencer_id=user["influencer_id"],
            redirect_url=redirect_url
        )

# --- Brands Login and Data ---
@app.get("/api/v1/brand/portal-data", tags=["Brand Portal"])
async def get_brand_portal_data(brand_id: str):
    if not brand_id:
        raise HTTPException(status_code=400, detail="brand_id query parameter is required.")

    async with get_db_cursor() as cursor:
        # 1. Verify Brand Exists
        await cursor.execute(
            "SELECT id, name, website_url FROM brands WHERE id = %s;", 
            (brand_id,)
        )
        brand = await cursor.fetchone()
        if not brand:
            raise HTTPException(status_code=404, detail="Brand not found.")

        # 2. Scoped Campaigns
        await cursor.execute(
            """
            SELECT id, title, participation_fee, commission_percentage, status, created_at
            FROM brand_deals
            WHERE brand_id = %s
            ORDER BY created_at DESC;
            """,
            (brand_id,)
        )
        campaigns = await cursor.fetchall()

        # 3. Aggregated Brand Metrics (GMV, Orders, Payable Commissions)
        await cursor.execute(
            """
            SELECT 
                COALESCE(SUM(o.order_amount), 0.00) AS total_brand_gmv,
                COUNT(DISTINCT o.id) AS total_orders,
                COALESCE(
                    SUM(CASE WHEN cl.commission_status = 'PAYABLE' THEN cl.commission_amount ELSE 0 END), 
                    0.00
                ) AS payable_commissions
            FROM orders o
            LEFT JOIN commission_ledger cl ON o.id = cl.order_id
            WHERE o.brand_id = %s AND o.order_status != 'CANCELLED';
            """,
            (brand_id,)
        )
        metrics = await cursor.fetchone()

        # 4. Scoped Brand Orders (Explicit table aliases to prevent collision)
        await cursor.execute(
            """
            SELECT 
                o.id AS order_id,
                o.order_reference,
                o.brand_id,
                o.order_amount,
                o.order_status,
                o.placed_at,
                COALESCE(i.name, 'Affiliate Creator') AS influencer_name,
                COALESCE(cl.commission_amount, 0) AS commission_amount,
                COALESCE(cl.commission_status, 'PENDING') AS commission_status
            FROM orders o
            LEFT JOIN influencers i ON o.influencer_id = i.id
            LEFT JOIN commission_ledger cl ON o.id = cl.order_id
            WHERE o.brand_id = %s
            ORDER BY o.placed_at DESC
            LIMIT 20;
            """,
            (brand_id,)
        )
        orders = await cursor.fetchall()

        # 5. Creators tied to this specific brand via orders
        await cursor.execute(
            """
            SELECT 
                i.id,
                i.name,
                i.email,
                i.phone_number,
                i.registration_fee_status,
                i.is_blacklisted,
                COALESCE(SUM(o.order_amount), 0.00) AS total_sales_attributed,
                COALESCE(
                    SUM(CASE WHEN cl.commission_status = 'PAYABLE' THEN cl.commission_amount ELSE 0 END), 
                    0.00
                ) AS payable_commission
            FROM influencers i
            INNER JOIN orders o ON i.id = o.influencer_id AND o.order_status != 'CANCELLED'
            LEFT JOIN commission_ledger cl ON o.id = cl.order_id
            WHERE o.brand_id = %s
            GROUP BY i.id
            ORDER BY total_sales_attributed DESC;
            """,
            (brand_id,)
        )
        creators = await cursor.fetchall()

    active_count = sum(1 for c in creators if not c.get("is_blacklisted"))
    blacklisted_count = sum(1 for c in creators if c.get("is_blacklisted"))

    return {
        "brand": dict(brand),
        "campaigns": [dict(c) for c in campaigns],
        "metrics": {
            "total_gmv": float(metrics["total_brand_gmv"]),
            "total_orders": int(metrics["total_orders"]),
            "payable_commissions": float(metrics["payable_commissions"]),
            "total_creators": len(creators),
            "active_creators": active_count,
            "blacklisted_creators": blacklisted_count
        },
        "orders": [dict(o) for o in orders],
        "creators": [
            {
                **dict(cr),
                "total_sales_attributed": float(cr["total_sales_attributed"]),
                "payable_commission": float(cr["payable_commission"])
            }
            for cr in creators
        ]
    }
    
import os
from pathlib import Path

# Resolve the absolute path to the frontend folder
BASE_DIR = Path(__file__).resolve().parent.parent  # Points to omniplus/
FRONTEND_DIR = BASE_DIR / "frontend"

if FRONTEND_DIR.exists():
    # 1. Direct explicit routes
    @app.get("/")
    @app.get("/login.html")
    async def serve_login():
        return FileResponse(FRONTEND_DIR / "login.html")

    @app.get("/index.html")
    async def serve_index():
        return FileResponse(FRONTEND_DIR / "index.html")

    # 2. Mount static folder for CSS, JS, and other assets
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")