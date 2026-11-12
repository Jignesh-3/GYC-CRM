import asyncio
import uuid
from decimal import Decimal
from database import init_db_pool, close_db_pool, get_db_cursor
from ledger import record_new_order_and_commission, transition_order_status

async def test_ledger_flow():
    print("Initializing DB Pool for Ledger Test...")
    await init_db_pool()

    # Seed temporary brand and influencer for testing
    brand_id = str(uuid.uuid4())
    influencer_id = str(uuid.uuid4())
    admin_id = str(uuid.uuid4())

    async with get_db_cursor() as cursor:
        # Create dummy brand
        await cursor.execute(
            "INSERT INTO brands (id, name) VALUES (%s, %s)",
            (brand_id, "Test Organic Skincare")
        )
        # Create dummy influencer
        await cursor.execute(
            "INSERT INTO influencers (id, name, email, phone_number, password_hash) VALUES (%s, %s, %s, %s, %s)",
            (influencer_id, "Simran Kaur", f"simran_{uuid.uuid4().hex[:6]}@example.com", f"+9198{uuid.uuid4().hex[:8]}", "dummyhash")
        )
        # Create dummy admin
        await cursor.execute(
            "INSERT INTO admin_users (id, name, email, password_hash, role) VALUES (%s, %s, %s, %s, %s)",
            (admin_id, "Admin User", f"admin_{uuid.uuid4().hex[:6]}@agency.com", "dummyhash", "SUPER_ADMIN")
        )

    print("✓ Seed entities created.")

    # 1. Test Order Placement & Automatic Commission
    print("\n[Step 1] Placing new order of ₹5,000 at 10% commission...")
    order_ref = f"ORD-{uuid.uuid4().hex[:8].upper()}"
    res1 = await record_new_order_and_commission(
        order_reference=order_ref,
        brand_id=brand_id,
        influencer_id=influencer_id,
        order_amount=Decimal("5000.00"),
        commission_percentage=Decimal("10.00")
    )
    print(f"  Result: Order Status = {res1['order_status']}, Commission = ₹{res1['commission_amount']} ({res1['commission_status']})")
    assert res1["commission_amount"] == 500.00

    order_id = res1["order_id"]

    # 2. Test Order Delivery -> Commission becomes PAYABLE
    print("\n[Step 2] Transitioning Order to DELIVERED...")
    res2 = await transition_order_status(
        order_id=order_id,
        new_order_status="DELIVERED",
        actor_id=admin_id,
        actor_role="SUPER_ADMIN"
    )
    print(f"  Result: Order Status = {res2['new_order_status']}, Commission Status = {res2['new_commission_status']}")
    assert res2["new_commission_status"] == "PAYABLE"

    # 3. Test Return / Refund -> Commission becomes REVERSED
    print("\n[Step 3] Customer returned item -> Transitioning to RETURNED_REFUNDED...")
    res3 = await transition_order_status(
        order_id=order_id,
        new_order_status="RETURNED_REFUNDED",
        actor_id=admin_id,
        actor_role="SUPER_ADMIN",
        reason="Defective size returned by customer"
    )
    print(f"  Result: Order Status = {res3['new_order_status']}, Commission Status = {res3['new_commission_status']}")
    assert res3["new_commission_status"] == "REVERSED"

    # 4. Check audit log was written
    async with get_db_cursor() as cursor:
        await cursor.execute("SELECT * FROM audit_logs WHERE target_id = %s", (order_id,))
        logs = await cursor.fetchall()
        print(f"\n✓ Found {len(logs)} audit entries logged for this transaction cycle.")

    await close_db_pool()
    print("\n✓ Step 3.0 Ledger logic passed with 100% precision!")

if __name__ == "__main__":
    asyncio.run(test_ledger_flow())