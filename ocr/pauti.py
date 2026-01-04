import os

# Custom libs
import __init__ as init
from setup_db import logger
from process_ocr import LocalOCRProcessor, save_to_sql

# ==========================================
# EXECUTION
# ==========================================
def main():
    # Create a dummy image or place 'test_receipt.jpg' in folder to run
    INPUT_FILE = "test_receipt.jpg"
    
    if os.path.exists(INPUT_FILE):
        processor = LocalOCRProcessor()
        
        # 1. Process
        logger.info("Processing receipt...")
        result_json = processor.run(INPUT_FILE)
        
        # 2. Show JSON
        print("\n--- JSON OUTPUT ---")
        print(result_json.model_dump_json(indent=2))
        
        # 3. Save to DB
        save_to_sql(result_json)
    
    else:
        print(f"Please provide a file named '{INPUT_FILE}'")



if __name__ == "__main__":
    main()