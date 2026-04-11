--attach database "E:\dev\pauti\db\pauti.db" as pauti

drop table if exists pauti
CREATE TABLE pauti.expenses (
    -- Unique ID (UUID) is safer for offline apps than Auto-Increment
    -- id TEXT PRIMARY KEY,
    
    -- Timestamps for Sync Logic
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    is_deleted INTEGER DEFAULT 0,

    -- Financial Data
    date TEXT NOT NULL,          -- SQLite stores dates as ISO8601 strings ("2025-09-30")
    pound REAL,                  -- Floating point for GBP
    rupee REAL,                  -- Floating point for INR
    rate REAL,                   -- Conversion rate used

    -- Categorization
    paymenttype TEXT,            -- cash, niyo, sbi, hsbc
    store TEXT,
    producttype TEXT,            -- groceries, travel, etc.
    product TEXT,                -- Item name
    
    -- Quantity & Metrics
    quantity REAL,
    metric TEXT,                 -- kg, litre, unit
    description TEXT,

    -- Split Logic
    paidby TEXT not null,
    paidfor TEXT,
    splitwith TEXT,              -- Comma separated names (e.g., "Alice,Bob")
    pplsplit INTEGER,             -- Number of people in the split
    is_settled integer
);

--drop table pauti.expenses
