import asyncio
import uuid
from decimal import Decimal
from backend.database import init_db_pool, close_db_pool, get_db_cursor
from backend.ledger import record_new_order_and_commission, transition_order_status

async def seed_agency_data():
    print("Initializing Database Pool for Seeding...")
    await init_db_pool()

    async with get_db_cursor() as cursor:
        # 1. Clean existing test data safely
        await cursor.execute("SET FOREIGN_KEY_CHECKS = 0;")
        await cursor.execute("TRUNCATE TABLE audit_logs;")
        await cursor.execute("TRUNCATE TABLE commission_ledger;")
        await cursor.execute("TRUNCATE TABLE orders;")
        await cursor.execute("TRUNCATE TABLE ugc_videos;")
        await cursor.execute("TRUNCATE TABLE brand_deals;")
        await cursor.execute("TRUNCATE TABLE influencers;")
        await cursor.execute("TRUNCATE TABLE brands;")
        await cursor.execute("TRUNCATE TABLE admin_users;")
        await cursor.execute("SET FOREIGN_KEY_CHECKS = 1;")

        # 2. Insert Super Admin User
        admin_id = "admin_sys_01"
        await cursor.execute(
            """
            INSERT INTO admin_users (id, name, email, password_hash, role)
            VALUES (%s, %s, %s, %s, 'SUPER_ADMIN')
            """,
            (admin_id, "Elena Rostova", "elena@getyoucollab.com", "argon2_mock_hash")
        )

        # 3. Insert Partner Brands (Nykaa & boAt)
        brand_nykaa = str(uuid.uuid4())
        brand_boat = str(uuid.uuid4())
        await cursor.execute(
            """
            INSERT INTO brands (id, name, website_url, whatsapp_status) VALUES
            (%s, 'Nykaa Beauty', 'https://nykaa.com', 'CONFIGURED'),
            (%s, 'boAt Lifestyle', 'https://boat-lifestyle.com', 'CONFIGURED')
            """,
            (brand_nykaa, brand_boat)
        )

        # 4. Insert Creators Roster
        inf_1 = str(uuid.uuid4())
        inf_2 = str(uuid.uuid4())
        inf_3 = str(uuid.uuid4())

        await cursor.execute(
            """
            INSERT INTO influencers (id, name, email, phone_number, password_hash, registration_fee_status, is_blacklisted, blacklist_reason)
            VALUES
            (%s, 'Aria Sharma', 'aria.sharma@collab.com', '+919820112345', 'hash123', 'PAID', 0, NULL),
            (%s, 'Rohan Verma', 'rohan.tech@collab.com', '+919711056789', 'hash123', 'PAID', 0, NULL),
            (%s, 'Kabir Patel', 'kabir.fits@collab.com', '+919988744321', 'hash123', 'UNPAID', 1, 'Inauthentic engagement and breach of brand brief')
            """,
            (inf_1, inf_2, inf_3)
        )

    print("✓ Entities seeded. Now attaching sample sales & commission ledger entries...")

    # 5. Seed Delivered Order with Payable Commission for Aria Sharma
    ord_1 = await record_new_order_and_commission(
        order_reference="ORD-NYK-8421",
        brand_id=brand_nykaa,
        influencer_id=inf_1,
        order_amount=Decimal("15000.00"),
        commission_percentage=Decimal("15.00"),
        customer_phone="+919820000001"
    )
    await transition_order_status(
        order_id=ord_1["order_id"],
        new_order_status="DELIVERED",
        actor_id=admin_id,
        actor_role="SUPER_ADMIN"
    )

    # 6. Seed Pending Order for Rohan Verma
    await record_new_order_and_commission(
        order_reference="ORD-BOAT-3312",
        brand_id=brand_boat,
        influencer_id=inf_2,
        order_amount=Decimal("7500.00"),
        commission_percentage=Decimal("10.00"),
        customer_phone="+919820000002"
    )

    await close_db_pool()
    print("\n✓ Seed completed! Your database now has active creators, orders, and ledger records.")

if __name__ == "__main__":
    asyncio.run(seed_agency_data())