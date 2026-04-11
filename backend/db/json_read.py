import json
import csv
import os
import sys


def convert_to_csv(input_path, output_path):
    # 1. Load the JSON
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"📂 Loaded {len(data)} receipts from JSON.")
    except FileNotFoundError:
        print(f"❌ Error: File not found at {input_path}")
        return

    # 2. Define CSV Headers
    # We combine Header info (Store, Date) with Line Item info (Name, Price)
    headers = [
        "Date", 
        "Store Name", 
        "Transaction No", 
        "Filename", 
        "Total Receipt Amount", 
        "Item Name", 
        "Item Price"
    ]

    # 3. Write to CSV
    try:
        with open(output_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            
            # Write Header Row
            writer.writerow(headers)

            row_count = 0
            
            # Iterate through each receipt
            for receipt in data:
                # Extract common receipt data
                r_date = receipt.get("date", "")
                r_store = receipt.get("store_name", "")
                r_trans = receipt.get("trans_no", "")
                r_file = receipt.get("filename", "")
                r_total = receipt.get("total_amount", 0.0)

                # Iterate through items in this receipt
                items = receipt.get("items", [])
                
                if not items:
                    # Handle case where receipt has no items (write one row with empty item fields)
                    writer.writerow([r_date, r_store, r_trans, r_file, r_total, "", ""])
                    row_count += 1
                else:
                    for item in items:
                        i_name = item.get("name", "Unknown")
                        i_price = item.get("price", 0.0)
                        
                        # Write the flattened row
                        writer.writerow([
                            r_date, 
                            r_store, 
                            r_trans, 
                            r_file, 
                            r_total, 
                            i_name, 
                            i_price
                        ])
                        row_count += 1

        print(f"✅ Success! Wrote {row_count} rows to: {output_path}")

    except Exception as e:
        print(f"❌ Error writing CSV: {e}")


if __name__ == "__main__":
    # Define paths relative to your project root
    INPUT_FILE = os.path.join("docs", "data", "extracts", "all_receipts.json")
    OUTPUT_FILE = os.path.join("docs", "data", "extracts", "all_receipts.csv")

    convert_to_csv(INPUT_FILE, OUTPUT_FILE)