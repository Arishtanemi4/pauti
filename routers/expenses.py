# app/routers/expenses.py
from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db
from ..services import ocr_engine

router = APIRouter(prefix="/expenses", tags=["Expenses"])

@router.post("/", response_model=schemas.ExpenseResponse)
def create_expense(expense: schemas.ExpenseCreate, db: Session = Depends(get_db)):
    db_expense = models.Expense(**expense.dict())
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)
    return db_expense

@router.get("/", response_model=List[schemas.ExpenseResponse])
def read_expenses(skip: int = 0, limit: int = 1000, db: Session = Depends(get_db)):
    # Fetching all expenses allows the Frontend to do local computation/charts
    return db.query(models.Expense).offset(skip).limit(limit).all()

@router.post("/upload/receipt")
async def upload_receipt(file: UploadFile = File(...)):
    content = await file.read()
    # Call the boilerplate service
    extracted_data = ocr_engine.extract_from_receipt_image(content)
    return {"status": "success", "extracted_data": extracted_data}