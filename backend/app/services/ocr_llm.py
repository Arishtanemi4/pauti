import cv2
import pytesseract
import json
import re
import ollama
import os
import glob
import dotenv

dotenv.load_dotenv()  # Load environment variables from .env file

# --- CONFIGURATION ---
IMAGE_DIRECTORY = os.getenv("INPUT_RECEIPT_DIR") 
OUTPUT_DIRECTORY = os.getenv("OUTPUT_JSON_DIR")
OLLAMA_MODEL = os.getenv("LLAMA3")  # or 'llama3.2' / 'phi3'

class LocalReceiptEngine:
    def __init__(self, image_path):
        self.image_path = image_path
        self.raw_text = ""

    def preprocess_image(self):
        """Standard preprocessing to help Tesseract read better."""
        img = cv2.imread(self.image_path)
        if img is None:
            return None

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # Otsu's thresholding
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        return thresh

    def run_ocr(self):
        """Step 1: Get raw text from image using Tesseract."""
        processed_img = self.preprocess_image()
        if processed_img is None:
            return ""
        
        # --psm 6 assumes a single block of text (good for receipts)
        custom_config = r'--oem 3 --psm 6' 
        self.raw_text = pytesseract.image_to_string(processed_img, config=custom_config)
        return self.raw_text

    def extract_data(self):
        """Step 2: Send raw text to local LLM (Ollama) for extraction."""
        if not self.raw_text:
            self.run_ocr()
            
        if not self.raw_text.strip():
            return None

        prompt = f"""
        You are a receipt data extraction assistant. 
        Extract the following fields from the raw OCR text below into a JSON object.
        
        REQUIRED JSON STRUCTURE:
        {{
            "store_name": "string (e.g. Lidl, Tesco)",
            "date": "YYYY-MM-DD",
            "total_amount": float,
            "items": [
                {{ "name": "product name", "price": float }}
            ],
            "trans_no": "string (Transaction ID)"
        }}

        RULES:
        1. Fix OCR typos (e.g., 'L4DL' -> 'Lidl').
        2. If a field is missing, use null.
        3. RETURN ONLY THE JSON. NO MARKDOWN.

        RAW TEXT:
        {self.raw_text}
        """

        try:
            response = ollama.chat(model=OLLAMA_MODEL, messages=[
                {'role': 'user', 'content': prompt},
            ])
            
            response_content = response['message']['content']
            return self._clean_json(response_content)

        except Exception as e:
            print(f"Error processing {os.path.basename(self.image_path)}: {e}")
            return None

    def _clean_json(self, response_text):
        cleaned = response_text.replace("```json", "").replace("```", "").strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r'\{.*\}', cleaned, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(0))
                except:
                    pass
            return None

# --- BATCH EXECUTION ---
if __name__ == "__main__":
    # 1. Get all PNG files
    png_files = glob.glob(os.path.join(IMAGE_DIRECTORY, "*.png"))
    
    print(f"Found {len(png_files)} receipts in {IMAGE_DIRECTORY}\n")
    
    all_receipts = []

    # 2. Loop through them
    for file_path in png_files:
        print(f"📄 Processing: {os.path.basename(file_path)}...", end=" ", flush=True)
        
        engine = LocalReceiptEngine(file_path)
        data = engine.extract_data()
        
        if data:
            data['filename'] = os.path.basename(file_path) # Add filename to JSON
            all_receipts.append(data)
            print("✅ Success")
        else:
            print("❌ Failed (No text or LLM error)")

    # 3. Save final output
    output_file = OUTPUT_DIRECTORY + "all_receipts.json"
    with open(output_file, 'w') as f:
        json.dump(all_receipts, f, indent=4)
        
    print(f"\n✨ Done! Saved {len(all_receipts)} receipts to {output_file}")