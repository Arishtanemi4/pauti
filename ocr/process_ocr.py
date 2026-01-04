import os
import re
import cv2
import datetime
import numpy as np
from typing import List, Optional, Tuple
from dateutil import parser as date_parser

from paddleocr import PaddleOCR
from pdf2image import convert_from_path
from pydantic import BaseModel
from setup_db import logger, ReceiptDB, LineItemDB, Session

# ==========================================
# 1. DATA STRUCTURES
# ==========================================
class LineItem(BaseModel):
    description: str
    price: float

class ReceiptData(BaseModel):
    merchant_name: str = "Unknown Store"
    date: Optional[str] = None
    items: List[LineItem] = []
    total: float = 0.0

# ==========================================
# 2. CORE LOGIC (PaddleOCR + Heuristics)
# ==========================================

class LocalOCRProcessor:
    def __init__(self):
        # use_angle_cls=True helps if the photo is rotated
        # lang='en' downloads the lightweight English model automatically
        logger.info("Loading PaddleOCR model (this may take a moment on first run)...")
        self.ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)

    def process_image(self, img_path: str) -> List:
        """Runs PaddleOCR on an image path."""
        # PaddleOCR expects a file path or numpy array
        result = self.ocr.ocr(img_path, cls=True)
        # Result structure: [ [ [ [x1,y1], [x2,y2]... ], ("text", conf) ], ... ]
        if not result or result[0] is None:
            return []
        return result[0]

    def pdf_to_image(self, pdf_path: str) -> str:
        """Converts PDF to temp image."""
        images = convert_from_path(pdf_path)
        temp_path = "temp_paddle.jpg"
        images[0].save(temp_path, "JPEG")
        return temp_path

    def parse_raw_ocr(self, raw_results: List) -> ReceiptData:
        """
        The 'Brain' of the operation. 
        Converts raw text boxes into structured JSON using geometry and regex.
        """
        extracted_lines = []
        
        # 1. Flatten and sort by Y-coordinate (top to bottom)
        # box[0] is coordinates, box[1] is (text, confidence)
        # Sort by the top-left Y coordinate (box[0][0][1])
        sorted_boxes = sorted(raw_results, key=lambda x: x[0][0][1])

        # 2. Group text into "Visual Lines" (handling left-to-right reading)
        # We assume text within 10 pixels vertically belongs to the same line
        rows = []
        if sorted_boxes:
            current_row = [sorted_boxes[0]]
            current_y = sorted_boxes[0][0][0][1]
            
            for box in sorted_boxes[1:]:
                y = box[0][0][1]
                if abs(y - current_y) < 15: # Threshold for "same line"
                    current_row.append(box)
                else:
                    # Sort the finished row from Left to Right (X coordinate)
                    current_row.sort(key=lambda x: x[0][0][0])
                    rows.append(current_row)
                    current_row = [box]
                    current_y = y
            # Append last row
            current_row.sort(key=lambda x: x[0][0][0])
            rows.append(current_row)

        # 3. Extract Fields using Heuristics
        merchant = rows[0][0][1][0] if rows else "Unknown" # Assume first line is merchant
        
        found_date = None
        line_items = []
        max_price = 0.0
        
        # Regex patterns
        price_pattern = re.compile(r'(\d+\.\d{2})')
        date_pattern = re.compile(r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}')

        for row in rows:
            row_text = " ".join([b[1][0] for b in row])
            
            # A. Look for Date (if not found yet)
            if not found_date:
                match = date_pattern.search(row_text)
                if match:
                    found_date = match.group(0)

            # B. Look for Prices
            prices = price_pattern.findall(row_text)
            if prices:
                # Get the last price in the line (usually the line total)
                try:
                    val = float(prices[-1])
                    # Track max price for "Total" guess
                    if val > max_price:
                        max_price = val
                    
                    # C. Formulate Line Item
                    # Remove the price from text to get description
                    desc = row_text.replace(prices[-1], "").strip()
                    # Filter out common noise (Total, Subtotal, Tax)
                    ignore_keywords = ['total', 'subtotal', 'tax', 'cash', 'change', 'due']
                    if desc and len(desc) > 3 and not any(k in desc.lower() for k in ignore_keywords):
                        line_items.append(LineItem(description=desc, price=val))
                except ValueError:
                    pass

        # 4. Final Assembly
        # If we found a "Total" label explicitly, we should use that, but max_price is a sturdy fallback
        return ReceiptData(
            merchant_name=merchant,
            date=found_date,
            items=line_items,
            total=max_price
        )

    def run(self, file_path: str) -> ReceiptData:
        if file_path.lower().endswith('.pdf'):
            img_path = self.pdf_to_image(file_path)
            is_temp = True
        else:
            img_path = file_path
            is_temp = False

        raw_results = self.process_image(img_path)
        structured_data = self.parse_raw_ocr(raw_results)
        
        if is_temp and os.path.exists(img_path):
            os.remove(img_path)
            
        return structured_data


# ==========================================
# 3. DATABASE INGESTION
# ==========================================
def save_to_sql(data: ReceiptData):
    session = Session()
    try:
        # Parse date
        p_date = None
        if data.date:
            try:
                p_date = date_parser.parse(data.date).date()
            except:
                pass
        
        receipt = ReceiptDB(
            merchant_name=data.merchant_name,
            transaction_date=p_date,
            total_amount=data.total
        )
        
        for item in data.items:
            receipt.items.append(LineItemDB(description=item.description, price=item.price))
            
        session.add(receipt)
        session.commit()
        logger.info(f"Saved: {data.merchant_name} | Total: {data.total}")
    except Exception as e:
        logger.error(f"DB Error: {e}")
        session.rollback()
    finally:
        session.close()