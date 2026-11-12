import asyncio
from backend.database import init_db_pool, close_db_pool, get_db_cursor

async def main():
    print("Testing MySQL connection...")
    await init_db_pool()
    
    async with get_db_cursor() as cursor:
        await cursor.execute("SHOW TABLES;")
        tables = await cursor.fetchall()
        print(f"\nConnected! Found {len(tables)} tables in database:")
        for t in tables:
            # table name key is typically 'Tables_in_getyoucollab_crm'
            table_name = list(t.values())[0]
            print(f"  • {table_name}")
            
    await close_db_pool()
    print("\n✓ Database test complete!")

if __name__ == "__main__":
    asyncio.run(main())