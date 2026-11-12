import os
import aiomysql
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Load credentials from .env
load_dotenv()

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", 3306))
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "getyoucollab_crm")
POOL_MIN = int(os.getenv("DB_POOL_MIN", 2))
POOL_MAX = int(os.getenv("DB_POOL_MAX", 10))

# Global connection pool holder
_pool: aiomysql.Pool | None = None


async def init_db_pool():
    """Initializes the async MySQL connection pool during FastAPI startup."""
    global _pool
    if _pool is None:
        _pool = await aiomysql.create_pool(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            db=DB_NAME,
            minsize=POOL_MIN,
            maxsize=POOL_MAX,
            autocommit=False,  # Strict transaction boundary control
            charset="utf8mb4",
            cursorclass=aiomysql.DictCursor,  # Returns rows as Python dictionaries
        )
        print("✓ MySQL Connection Pool initialized successfully.")


async def close_db_pool():
    """Closes all connections cleanly when FastAPI shuts down."""
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None
        print("✓ MySQL Connection Pool closed cleanly.")


@asynccontextmanager
async def get_db_cursor():
    """
    Async context manager yielding a dictionary cursor with atomic transaction guarantees.
    
    Usage:
        async with get_db_cursor() as cursor:
            await cursor.execute("SELECT * FROM influencers WHERE id = %s", (influencer_id,))
            result = await cursor.fetchone()
    """
    global _pool
    if _pool is None:
        raise RuntimeError("Database connection pool is not initialized. Call init_db_pool() first.")

    async with _pool.acquire() as connection:
        async with connection.cursor() as cursor:
            try:
                yield cursor
                await connection.commit()
            except Exception:
                await connection.rollback()
                raise