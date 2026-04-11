import cv2
import pytesseract
import re
import numpy as np
from datetime import datetime
import dotenv

dotenv.load_dotenv()  # Load environment variables from .env file

# CONFIGURATION
# If Tesseract is not in your PATH, uncomment and set the line below:
# pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

class ReceiptOCREngine:
    def __init__(self, image_path):
        self.image_path = image_path
        self.raw_text = ""
        self.data = {
            "vendor_name": None,
            "date": None,
            "total_amount": 0.0,
            "tax_amount": 0.0,
            "invoice_id": None
        }

    def preprocess_image(self):
        """
        Reads image, converts to grayscale, and applies thresholding
        to remove noise and shadows common in receipts.
        """
        img = cv2.imread(self.image_path)
        
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Apply thresholding (Otsu's binarization)
        # This makes the text black and background white
        text_img = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
        
        return text_img

    def run_ocr(self):
        """Executes Tesseract OCR on the preprocessed image."""
        processed_img = self.preprocess_image()
        
        # psm 6 = Assume a single uniform block of text (good for receipts)
        config_str = '--psm 6' 
        self.raw_text = pytesseract.image_to_string(processed_img, config=config_str)
        return self.raw_text

    def parse_data(self):
        """
        Parses the raw text using Regex to match the Schema.
        """
        text_lines = self.raw_text.split('\n')
        
        # --- 1. Extract Vendor (Heuristic: Usually the first non-empty line) ---
        for line in text_lines:
            clean_line = line.strip()
            if clean_line and len(clean_line) > 3:
                self.data["vendor_name"] = clean_line
                break

        # --- 2. Extract Date ---
        # Regex for various formats: DD/MM/YYYY, MM-DD-YY, YYYY.MM.DD
        date_pattern = r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})'
        match_date = re.search(date_pattern, self.raw_text)
        if match_date:
            self.data["date"] = match_date.group(0)

        # --- 3. Extract Total Amount ---
        # Looks for "Total" followed by a number, handling '$' and ','
        total_pattern = r'(?i)total[\s:]*?\$?([\d,]+\.\d{2})'
        match_total = re.search(total_pattern, self.raw_text)
        if match_total:
            self.data["total_amount"] = float(match_total.group(1).replace(',', ''))

        # --- 4. Extract Tax (Optional) ---
        tax_pattern = r'(?i)tax[\s:]*?\$?([\d,]+\.\d{2})'
        match_tax = re.search(tax_pattern, self.raw_text)
        if match_tax:
            self.data["tax_amount"] = float(match_tax.group(1).replace(',', ''))
            
        return self.data

# --- Usage ---
if __name__ == "__main__":
    # Replace with your actual bill image path
    engine = ReceiptOCREngine("e:/dev/pauti/backend/docs/data/reciepts/2026.02.04_130019857120260204236225.png")
    
    print("--- Raw OCR Output ---")
    print(engine.run_ocr())
    
    print("\n--- Extracted Data (Schema) ---")
    extracted_data = engine.parse_data()
    print(extracted_data)