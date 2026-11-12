from decimal import Decimal
from pydantic import ValidationError
from schemas import (
    AdminCreateRequest,
    InfluencerCreateRequest,
    OrderIngestRequest,
    OrderStatusUpdateRequest,
    OrderStatus
)

def test_schemas():
    print("Testing Pydantic Data Contracts...")

    # 1. Test Valid Admin Request
    admin = AdminCreateRequest(
        name="Elena Rostova",
        email="elena@getyoucollab.com",
        password="SecurePassword123!",
        role="SUPER_ADMIN"
    )
    assert admin.name == "Elena Rostova"
    print("  ✓ Admin validation passed.")

    # 2. Test Invalid Phone Number (Must fail)
    try:
        InfluencerCreateRequest(
            name="John Doe",
            email="john@example.com",
            phone_number="not-a-phone-number",
            password="Password123!"
        )
        assert False, "Should have thrown ValidationError for invalid phone number"
    except ValidationError:
        print("  ✓ Phone regex constraint caught invalid number successfully.")

    # 3. Test Invalid Commission Percentage > 100% (Must fail)
    try:
        OrderIngestRequest(
            order_reference="ORD-TEST-99",
            brand_id="b1",
            influencer_id="i1",
            order_amount=Decimal("1500.00"),
            commission_percentage=Decimal("125.00")  # > 100%
        )
        assert False, "Should have thrown ValidationError for commission > 100%"
    except ValidationError:
        print("  ✓ Financial constraint prevented commission percentage > 100%.")

    # 4. Test Valid Status Transition
    status_req = OrderStatusUpdateRequest(
        new_order_status=OrderStatus.RETURNED_REFUNDED,
        reason="Wrong shoe size"
    )
    assert status_req.new_order_status == OrderStatus.RETURNED_REFUNDED
    print("  ✓ Order status validation passed.")

    print("\n✓ Step 4.0 Schemas validated with 100% precision!")

if __name__ == "__main__":
    test_schemas()