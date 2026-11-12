import uuid
import json
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Dict, Any, List
from backend.database import get_db_cursor


def round_currency(value: Decimal) -> Decimal:
    """Rounds values strictly to 2 decimal places for financial calculations."""
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calculate_commission_amount(order_amount: Decimal, commission_percentage: Decimal) -> Decimal:
    """
    Computes commission based on order value and campaign percentage.
    e.g., ₹10,000 order at 15% = ₹1,500.00
    """
    raw_commission = (order_amount * commission_percentage) / Decimal("100.00")
    return round_currency(raw_commission)


async def record_new_order_and_commission(
    order_reference: str,
    brand_id: str,
    influencer_id: str,
    order_amount: Decimal,
    commission_percentage: Decimal,
    ugc_video_id: Optional[str] = None,
    customer_phone: Optional[str] = None
) -> Dict[str, Any]:
    """
    Creates an incoming order and immediately logs the initial PENDING commission entry.
    Wrapped in an atomic transaction via get_db_cursor.
    """
    order_id = str(uuid.uuid4())
    commission_id = str(uuid.uuid4())
    commission_val = calculate_commission_amount(order_amount, commission_percentage)

    async with get_db_cursor() as cursor:
        # 1. Insert Order
        await cursor.execute(
            """
            INSERT INTO orders (
                id, order_reference, brand_id, influencer_id, ugc_video_id, 
                customer_phone, order_amount, order_status, placed_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'PENDING', NOW())
            """,
            (order_id, order_reference, brand_id, influencer_id, ugc_video_id, customer_phone, order_amount)
        )

        # 2. Insert Commission Ledger Entry (Starts as PENDING)
        await cursor.execute(
            """
            INSERT INTO commission_ledger (
                id, order_id, influencer_id, commission_rate, commission_amount, 
                commission_status
            ) VALUES (%s, %s, %s, %s, %s, 'PENDING')
            """,
            (commission_id, order_id, influencer_id, commission_percentage, commission_val)
        )

    return {
        "order_id": order_id,
        "commission_id": commission_id,
        "order_amount": float(order_amount),
        "commission_amount": float(commission_val),
        "order_status": "PENDING",
        "commission_status": "PENDING"
    }


async def transition_order_status(
    order_id: str,
    new_order_status: str,
    actor_id: str,
    actor_role: str,
    reason: Optional[str] = None
) -> Dict[str, Any]:
    """
    Transitions order status and synchronizes the commission lifecycle state:
    - Sets delivered_at = NOW() when order status transitions to DELIVERED.
    - Prevents overwriting already PAID commissions unless reversed.
    - Emits structured audit log entries.
    """
    valid_order_statuses = {'PENDING', 'CONFIRMED', 'DELIVERED', 'CANCELLED', 'RETURNED_REFUNDED'}
    if new_order_status not in valid_order_statuses:
        raise ValueError(f"Invalid order status: {new_order_status}")

    async with get_db_cursor() as cursor:
        # 1. Fetch current order & ledger state with row locking
        await cursor.execute(
            """
            SELECT o.id, o.order_reference, o.order_status, 
                   cl.id AS ledger_id, cl.commission_status
            FROM orders o
            LEFT JOIN commission_ledger cl ON o.id = cl.order_id
            WHERE o.id = %s
            FOR UPDATE;
            """,
            (order_id,)
        )
        order = await cursor.fetchone()
        if not order:
            raise LookupError(f"Order {order_id} not found.")

        old_order_status = order["order_status"]
        old_commission_status = order["commission_status"]

        # 2. Determine target commission status
        if new_order_status in ('CANCELLED', 'RETURNED_REFUNDED'):
            new_commission_status = 'REVERSED'
        elif new_order_status == 'DELIVERED':
            # Do not downgrade if already paid out
            new_commission_status = 'PAYABLE' if old_commission_status != 'PAID' else 'PAID'
        elif new_order_status == 'CONFIRMED':
            new_commission_status = 'APPROVED' if old_commission_status != 'PAID' else 'PAID'
        else:
            new_commission_status = 'PENDING'

        # 3. Update Order record (setting delivered_at when DELIVERED)
        if new_order_status == 'DELIVERED':
            await cursor.execute(
                """
                UPDATE orders 
                SET order_status = %s, delivered_at = NOW() 
                WHERE id = %s
                """,
                (new_order_status, order_id)
            )
        else:
            await cursor.execute(
                """
                UPDATE orders 
                SET order_status = %s 
                WHERE id = %s
                """,
                (new_order_status, order_id)
            )

        # 4. Update Commission Ledger if status changed
        if order["ledger_id"] and new_commission_status != old_commission_status:
            await cursor.execute(
                """
                UPDATE commission_ledger 
                SET commission_status = %s 
                WHERE order_id = %s
                """,
                (new_commission_status, order_id)
            )

        # 5. Insert structured audit log
        audit_id = str(uuid.uuid4())
        metadata = json.dumps({
            "order_reference": order["order_reference"],
            "old_order_status": old_order_status,
            "new_order_status": new_order_status,
            "old_commission_status": old_commission_status,
            "new_commission_status": new_commission_status,
            "reason": reason or "Status transition update"
        })

        await cursor.execute(
            """
            INSERT INTO audit_logs (
                id, actor_id, actor_role, action_type, target_entity, target_id, metadata_json
            ) VALUES (%s, %s, %s, 'ORDER_STATUS_UPDATE', 'orders', %s, %s)
            """,
            (audit_id, actor_id, actor_role, order_id, metadata)
        )

    return {
        "order_id": order_id,
        "old_order_status": old_order_status,
        "new_order_status": new_order_status,
        "new_commission_status": new_commission_status
    }

async def disburse_creator_payout(
    influencer_id: str,
    payout_reference: str,
    actor_id: str = "admin_sys_01",
    actor_role: str = "SUPER_ADMIN"
) -> Dict[str, Any]:
    """
    Atomically transitions all PAYABLE commissions for a creator to PAID.
    Locks records with FOR UPDATE and records an audit trail entry.
    """
    async with get_db_cursor() as cursor:
        # 1. Fetch and lock all PAYABLE commissions for this creator
        await cursor.execute(
            """
            SELECT id, commission_amount 
            FROM commission_ledger 
            WHERE influencer_id = %s AND commission_status = 'PAYABLE'
            FOR UPDATE;
            """,
            (influencer_id,)
        )
        payable_records = await cursor.fetchall()

        if not payable_records:
            return {
                "status": "NO_OP",
                "message": "No payable commissions found for this creator.",
                "disbursed_count": 0,
                "total_disbursed": 0.00
            }

        total_disbursed = sum(Decimal(str(r["commission_amount"])) for r in payable_records)
        ledger_ids = [r["id"] for r in payable_records]

        # 2. Bulk transition status to PAID
        format_strings = ','.join(['%s'] * len(ledger_ids))
        await cursor.execute(
            f"""
            UPDATE commission_ledger 
            SET commission_status = 'PAID'
            WHERE id IN ({format_strings});
            """,
            tuple(ledger_ids)
        )

        # 3. Write payout audit record
        audit_id = str(uuid.uuid4())
        metadata = json.dumps({
            "influencer_id": influencer_id,
            "payout_reference": payout_reference,
            "disbursed_count": len(ledger_ids),
            "total_disbursed": float(total_disbursed)
        })

        await cursor.execute(
            """
            INSERT INTO audit_logs (
                id, actor_id, actor_role, action_type, target_entity, target_id, metadata_json
            ) VALUES (%s, %s, %s, 'COMMISSION_PAYOUT_DISBURSED', 'influencers', %s, %s);
            """,
            (audit_id, actor_id, actor_role, influencer_id, metadata)
        )

        return {
            "status": "SUCCESS",
            "influencer_id": influencer_id,
            "payout_reference": payout_reference,
            "disbursed_count": len(ledger_ids),
            "total_disbursed": float(total_disbursed)
        }

async def submit_ugc_deliverable(
    influencer_id: str,
    brand_deal_id: str,
    video_url: str,
    caption_copy: Optional[str] = None
) -> Dict[str, Any]:
    """
    Records a creator's submitted UGC draft/reel link for an active brand campaign.
    Starts with review_status = 'SUBMITTED'.
    """
    ugc_id = str(uuid.uuid4())

    async with get_db_cursor() as cursor:
        # Check if campaign exists AND fetch brand_id
        await cursor.execute(
            "SELECT id, brand_id, title FROM brand_deals WHERE id = %s",
            (brand_deal_id,)
        )
        deal = await cursor.fetchone()
        if not deal:
            raise LookupError(f"Brand deal {brand_deal_id} not found.")

        brand_id = deal["brand_id"]

        # Insert UGC submission record including brand_id
        await cursor.execute(
            """
            INSERT INTO ugc_videos (
                id, brand_id, brand_deal_id, influencer_id, video_url, caption_copy, 
                review_status, submitted_at
            ) VALUES (%s, %s, %s, %s, %s, %s, 'SUBMITTED', NOW());
            """,
            (ugc_id, brand_id, brand_deal_id, influencer_id, video_url, caption_copy)
        )

        # Immutable audit log
        audit_id = str(uuid.uuid4())
        metadata = json.dumps({
            "brand_id": brand_id,
            "brand_deal_id": brand_deal_id,
            "campaign_title": deal["title"],
            "video_url": video_url
        })
        await cursor.execute(
            """
            INSERT INTO audit_logs (
                id, actor_id, actor_role, action_type, target_entity, target_id, metadata_json
            ) VALUES (%s, %s, 'INFLUENCER', 'UGC_SUBMITTED', 'ugc_videos', %s, %s);
            """,
            (audit_id, influencer_id, ugc_id, metadata)
        )

    return {
        "status": "SUCCESS",
        "ugc_id": ugc_id,
        "brand_id": brand_id,
        "brand_deal_id": brand_deal_id,
        "influencer_id": influencer_id,
        "review_status": "SUBMITTED"
    }


async def review_ugc_deliverable(
    ugc_id: str,
    review_status: str,
    admin_feedback: Optional[str] = None,
    actor_id: str = "admin_sys_01",
    actor_role: str = "SUPER_ADMIN"
) -> Dict[str, Any]:
    """
    Admin approval/revision workflow for UGC drafts.
    When APPROVED:
    - Sets review_status = 'APPROVED'
    - Automatically credits the campaign's participation_fee to the creator's ledger as PAYABLE.
    """
    valid_statuses = {"APPROVED", "REVISION_REQUESTED", "REJECTED"}
    if review_status not in valid_statuses:
        raise ValueError(f"Invalid review status: {review_status}. Must be one of {valid_statuses}")

    async with get_db_cursor() as cursor:
        # Fetch UGC submission details and associated brand deal
        await cursor.execute(
            """
            SELECT u.id, u.brand_deal_id, u.influencer_id, u.review_status,
                   b.title AS campaign_title, b.participation_fee
            FROM ugc_videos u
            JOIN brand_deals b ON u.brand_deal_id = b.id
            WHERE u.id = %s
            FOR UPDATE;
            """,
            (ugc_id,)
        )
        ugc = await cursor.fetchone()
        if not ugc:
            raise LookupError(f"UGC submission {ugc_id} not found.")

        old_status = ugc["review_status"]
        participation_fee = Decimal(str(ugc["participation_fee"] or 0.00))

        # 1. Update UGC status and feedback
        await cursor.execute(
            """
            UPDATE ugc_videos 
            SET review_status = %s, admin_feedback = %s, reviewed_at = NOW()
            WHERE id = %s;
            """,
            (review_status, admin_feedback, ugc_id)
        )

        # 2. If APPROVED and has a participation fee, credit it to commission_ledger as PAYABLE
        payout_ledger_id = None
        if review_status == "APPROVED" and old_status != "APPROVED" and participation_fee > Decimal("0.00"):
            payout_ledger_id = str(uuid.uuid4())
            await cursor.execute(
                """
                INSERT INTO commission_ledger (
                    id, order_id, influencer_id, commission_rate, commission_amount, 
                    commission_status
                ) VALUES (%s, NULL, %s, 100.00, %s, 'PAYABLE');
                """,
                (payout_ledger_id, ugc["influencer_id"], participation_fee)
            )

        # 3. Create Audit Trail Entry
        audit_id = str(uuid.uuid4())
        metadata = json.dumps({
            "ugc_id": ugc_id,
            "campaign_title": ugc["campaign_title"],
            "old_status": old_status,
            "new_status": review_status,
            "admin_feedback": admin_feedback,
            "participation_fee_credited": float(participation_fee) if review_status == "APPROVED" else 0.00,
            "ledger_id": payout_ledger_id
        })
        await cursor.execute(
            """
            INSERT INTO audit_logs (
                id, actor_id, actor_role, action_type, target_entity, target_id, metadata_json
            ) VALUES (%s, %s, %s, 'UGC_REVIEW_DECISION', 'ugc_videos', %s, %s);
            """,
            (audit_id, actor_id, actor_role, ugc_id, metadata)
        )

    return {
        "status": "SUCCESS",
        "ugc_id": ugc_id,
        "old_status": old_status,
        "review_status": review_status,
        "fee_credited": float(participation_fee) if review_status == "APPROVED" else 0.00
    }

async def execute_batch_payout(
    cursor,
    admin_id: str,
    batch_reference: str,
    payment_mode: str,
    disbursements: List[Dict[str, Any]],
    admin_notes: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes an atomic batch payout settlement across selected creators.
    Locks records, updates status to 'PAID', and writes audit logs.
    """
    results = []
    total_disbursed_sum = 0.0

    for item in disbursements:
        inf_id = item["influencer_id"]

        # 1. Row-level lock on eligible PAYABLE entries for this creator
        await cursor.execute(
            """
            SELECT id, commission_amount 
            FROM commission_ledger 
            WHERE influencer_id = %s AND commission_status = 'PAYABLE'
            FOR UPDATE;
            """,
            (inf_id,)
        )
        rows = await cursor.fetchall()
        
        if not rows:
            continue

        current_payable = sum(float(r["commission_amount"]) for r in rows)
        line_item_ids = [r["id"] for r in rows]

        # 2. Update status to PAID using your schema's payout_batch_id and payout_timestamp
        format_strings = ','.join(['%s'] * len(line_item_ids))
        await cursor.execute(
            f"""
            UPDATE commission_ledger 
            SET commission_status = 'PAID',
                payout_batch_id = %s,
                payout_timestamp = NOW()
            WHERE id IN ({format_strings});
            """,
            [batch_reference, *line_item_ids]
        )

        # 3. Create disbursement record in payout_disbursements
        disbursement_id = str(uuid.uuid4())
        await cursor.execute(
            """
            INSERT INTO payout_disbursements (
                id, batch_reference, payment_mode, admin_actor_id,
                influencer_id, disbursed_amount, line_items_count, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
            """,
            (
                disbursement_id, batch_reference, payment_mode, admin_id,
                inf_id, current_payable, len(line_item_ids), admin_notes
            )
        )

        # 4. Immutable audit trail entry
        audit_id = str(uuid.uuid4())
        metadata = json.dumps({
            "batch_reference": batch_reference,
            "payment_mode": payment_mode,
            "disbursed_amount": current_payable,
            "entries_settled": len(line_item_ids)
        })
        await cursor.execute(
            """
            INSERT INTO audit_logs (
                id, actor_id, actor_role, action_type, target_entity, target_id, metadata_json
            ) VALUES (%s, %s, 'ADMIN', 'COMMISSION_PAYOUT_DISBURSED', 'influencers', %s, %s);
            """,
            (audit_id, admin_id, inf_id, metadata)
        )

        total_disbursed_sum += current_payable
        results.append({
            "influencer_id": inf_id,
            "disbursed_amount": current_payable,
            "entries_settled": len(line_item_ids)
        })

    return {
        "status": "SUCCESS",
        "batch_reference": batch_reference,
        "total_disbursed_sum": total_disbursed_sum,
        "creators_settled": len(results),
        "details": results
    }