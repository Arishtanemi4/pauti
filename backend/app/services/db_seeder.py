import os
import json
import sqlite3
import dotenv

dotenv.load_dotenv()  # Load environment variables from .env file

# --- CONFIGURATION ---
JSON_SOURCE = os.getenv("OUTPUT_JSON_DIR") + "all_receipts.json"  # Path to the JSON file with extracted data
DB_PATH = os.getenv("DB_PATH")  # Path to the SQLite database

class DatabaseLoader:
    def __init__(self):
        self.conn = sqlite3.connect(DB_PATH)
        self.cur = self.conn.cursor()

    def get_or_create_store(self, name, vatin):
        """Ensures store exists in pauti.stores and returns ID."""
        # Clean name
        name = name.strip() if name else "Unknown Store"
        
        # Check existing
        self.cur.execute("SELECT id FROM stores WHERE name = ?", (name,))
        res = self.cur.fetchone()
        if res:
            return res[0]
        
        # Insert new
        print(f"   + New Store: {name}")
        self.cur.execute("INSERT INTO stores (name, vatin) VALUES (?, ?)", (name, vatin))
        return self.cur.lastrowid

    def get_or_create_product(self, name):
        """Ensures product exists in pauti.products (Master table)."""
        name = name.strip() if name else "Unknown Item"
        
        self.cur.execute("SELECT id FROM products WHERE name = ?", (name,))
        res = self.cur.fetchone()
        if res:
            return res[0]
        
        # Insert new
        print(f"   + New Product: {name}")
        self.cur.execute("INSERT INTO products (name) VALUES (?)", (name,))
        return self.cur.lastrowid

    def load_data(self):
        with open(JSON_SOURCE, 'r') as f:
            receipts = json.load(f)

        print(f"Loading {len(receipts)} receipts into database...")

        for r in receipts:
            try:
                print(f"📥 Importing receipt from {r.get('date', 'Unknown Date')}")

                # 1. Handle STORE Dependency
                store_id = self.get_or_create_store(r.get('store_name'), r.get('vatin'))

                # 2. Insert TRANSACTION HEADER (Dependent on Store)
                # Assuming table 'transactions_header'
                sql_header = """
                    INSERT INTO transactions_header 
                    (store_id, date, total_amount, trans_no, terminal_id, merchant_id) 
                    VALUES (?, ?, ?, ?, ?, ?)
                """
                self.cur.execute(sql_header, (
                    store_id, 
                    r.get('date'), 
                    r.get('total_amount'), 
                    r.get('trans_no'), 
                    r.get('tid'), 
                    r.get('mid')
                ))
                transaction_id = self.cur.lastrowid

                # 3. Handle ITEMS (Transaction Lines)
                # Dependent on Transaction Header AND Products
                items = r.get('items', [])
                if items:
                    for item in items:
                        # A. Get Master Product ID
                        product_id = self.get_or_create_product(item['name'])

                        # B. Insert Line
                        sql_line = """
                            INSERT INTO transaction_lines 
                            (transaction_id, product_id, price) 
                            VALUES (?, ?, ?)
                        """
                        self.cur.execute(sql_line, (transaction_id, product_id, item['price']))

                self.conn.commit() # Commit after each receipt to be safe

            except Exception as e:
                print(f"❌ Error loading receipt: {e}")
                self.conn.rollback()

        print("✅ Database population complete.")

if __name__ == "__main__":
    loader = DatabaseLoader()
    # Uncomment this line if you need to create the dummy tables first to test
    # loader.create_dummy_schema() 
    loader.load_data()